//! Mandate 3-B — A4 invoice PDF via the native **Typst** compiler.
//!
//! Typst is a Rust-native typesetting engine: it compiles a document template
//! to PDF entirely in-process (no Puppeteer, no headless Chrome, no external
//! binary). We embed a small `World` (the trait Typst uses to resolve sources +
//! fonts), bundle the default fonts from `typst-assets`, build the invoice
//! source from `InvoiceData`, compile it, and export PDF bytes via `typst-pdf`.
//!
//! `print_a4` / `open_pdf_preview` are unchanged — they take raw PDF bytes and
//! are agnostic to how the bytes were produced.

use std::sync::OnceLock;

use comemo::Prehashed;
use serde::{Deserialize, Serialize};
use typst::diag::{FileError, FileResult};
use typst::eval::Tracer;
use typst::foundations::{Bytes, Datetime, Smart};
use typst::syntax::{FileId, Source};
use typst::text::{Font, FontBook};
use typst::{Library, World};

use crate::config;
use crate::error::{HardwareError, HwResult};
use crate::mock::printer_mock;

// ────────────────────────────────────────────────────────────────────────
// Wire-format structs — TypeScript mirror lives in `hooks/useInvoicePdf.ts`.
// ────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceItem {
    pub description: String,
    pub quantity: u32,
    pub unit_price_eur: String,
    /// VAT rate as printed, e.g. "19" / "7" / "" for §25a/§25c margin schemes.
    pub vat_rate: String,
    pub total_eur: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceData {
    pub invoice_number: String,
    pub date: String,
    pub seller_name: String,
    pub items: Vec<InvoiceItem>,
    pub subtotal_eur: String,
    pub vat_total_eur: String,
    pub total_eur: String,
    /// Legal tax note (§25a / §25c / §13b), printed if present.
    pub tax_note: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintA4Params {
    /// macOS / Linux print queue name (from `lpstat -p`).
    pub printer_name: String,
    /// Raw PDF bytes — typically the output of `generate_invoice_pdf`.
    pub pdf_bytes: Vec<u8>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfPreviewResult {
    /// Where on disk we saved the PDF before opening it.
    pub temp_path: String,
}

// ────────────────────────────────────────────────────────────────────────
// Commands
// ────────────────────────────────────────────────────────────────────────

/// Render an `InvoiceData` to PDF bytes via Typst. Pure CPU work — runs on the
/// blocking pool so we never starve the Tauri event loop.
#[tauri::command]
pub async fn generate_invoice_pdf(data: InvoiceData) -> Result<Vec<u8>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let source = build_invoice_source(&data);
        compile_typst_to_pdf(source)
    })
    .await
    .map_err(|e| format!("invoice render task join failed: {e}"))?
}

/// Hand the PDF bytes to the OS print spool (macOS / Linux `lpr`).
#[tauri::command]
pub async fn print_a4(params: PrintA4Params) -> HwResult<()> {
    if config::is_mock_mode() {
        return printer_mock::print_a4(params).await;
    }
    let tmp = std::env::temp_dir().join(format!("warehouse14-invoice-{}.pdf", uuid_like()));
    std::fs::write(&tmp, &params.pdf_bytes).map_err(HardwareError::from)?;

    let status = tokio::process::Command::new("lpr")
        .arg("-P")
        .arg(&params.printer_name)
        .arg(&tmp)
        .status()
        .await
        .map_err(HardwareError::from)?;

    let _ = std::fs::remove_file(&tmp);

    if !status.success() {
        return Err(HardwareError::Device(format!(
            "lpr exited with {:?}",
            status.code()
        )));
    }
    Ok(())
}

/// Save the PDF to a temp path and ask the OS to open it (Preview.app on macOS).
#[tauri::command]
pub async fn open_pdf_preview(
    pdf_bytes: Vec<u8>,
    app_handle: tauri::AppHandle,
) -> HwResult<PdfPreviewResult> {
    let tmp = std::env::temp_dir().join(format!("warehouse14-preview-{}.pdf", uuid_like()));
    std::fs::write(&tmp, &pdf_bytes).map_err(HardwareError::from)?;

    #[allow(deprecated)]
    {
        use tauri_plugin_shell::ShellExt;
        app_handle
            .shell()
            .open(tmp.to_string_lossy().into_owned(), None)
            .map_err(|e| HardwareError::Internal(format!("shell::open failed: {e}")))?;
    }

    // Best-effort same-session cleanup (DSGVO, Phase 3.8): the external viewer has
    // loaded the file long before this fires (it holds its own copy), so removing
    // the temp PDF — with the customer name + §25a data — is safe. If the app dies
    // before this fires, the boot-time sweep catches the orphan. Never blocks.
    let tmp_for_cleanup = tmp.clone();
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(300)).await;
        let _ = std::fs::remove_file(&tmp_for_cleanup);
    });

    Ok(PdfPreviewResult {
        temp_path: tmp.to_string_lossy().into_owned(),
    })
}

// ────────────────────────────────────────────────────────────────────────
// Typst compilation
// ────────────────────────────────────────────────────────────────────────

/// Compile a Typst source string to PDF bytes. Shared by the command and tests.
pub fn compile_typst_to_pdf(source: String) -> Result<Vec<u8>, String> {
    let world = TypstWorld::new(source);
    let mut tracer = Tracer::new();
    let document = typst::compile(&world, &mut tracer).map_err(|errors| {
        errors
            .first()
            .map(|d| format!("typst compile error: {}", d.message))
            .unwrap_or_else(|| "typst compile failed".to_string())
    })?;
    Ok(typst_pdf::pdf(&document, Smart::Auto, None))
}

/// Escape a value for safe insertion as a Typst code-mode string literal
/// (`#"..."`), which renders verbatim with no markup interpretation.
fn esc(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

/// Build the full Typst document source for an invoice. The static styling is
/// the embedded template; the dynamic values are injected as `#"..."` literals.
fn build_invoice_source(data: &InvoiceData) -> String {
    let mut rows = String::new();
    for item in &data.items {
        let vat = if item.vat_rate.trim().is_empty() {
            "—".to_string()
        } else {
            format!("{} %", item.vat_rate)
        };
        rows.push_str(&format!(
            "  [#\"{}\"], [#\"{}\"], [#\"{} €\"], [#\"{}\"], [#\"{} €\"],\n",
            esc(&item.description),
            item.quantity,
            esc(&item.unit_price_eur),
            esc(&vat),
            esc(&item.total_eur),
        ));
    }

    let tax_note_block = match &data.tax_note {
        Some(note) if !note.trim().is_empty() => format!(
            "#v(1.2em)\n#text(size: 9pt, fill: rgb(\"#555555\"))[#\"{}\"]\n",
            esc(note)
        ),
        _ => String::new(),
    };

    format!(
        "{header}\n\
#text(size: 18pt, weight: \"bold\")[WAREHOUSE 14]\n\
#v(0.2em)\n\
#text(size: 11pt)[Verkäufer: #\"{seller}\"]\n\
#v(0.4em)\n\
Rechnung Nr. #\"{invno}\" #h(1fr) Datum: #\"{date}\"\n\
#line(length: 100%, stroke: 0.5pt)\n\
#v(0.8em)\n\
#table(\n\
  columns: (1fr, auto, auto, auto, auto),\n\
  align: (left, right, right, right, right),\n\
  table.header(\n\
    [*Beschreibung*], [*Menge*], [*Einzelpreis*], [*MwSt.*], [*Summe*],\n\
  ),\n\
{rows}\
)\n\
#v(0.6em)\n\
#align(right)[\n\
  Zwischensumme: #\"{subtotal} €\" \\\n\
  MwSt. gesamt: #\"{vat_total} €\" \\\n\
  #text(size: 13pt, weight: \"bold\")[Gesamt: #\"{total} €\"]\n\
]\n\
{tax_note}",
        header = "#set page(paper: \"a4\", margin: 2cm)\n#set text(size: 10pt)",
        seller = esc(&data.seller_name),
        invno = esc(&data.invoice_number),
        date = esc(&data.date),
        rows = rows,
        subtotal = esc(&data.subtotal_eur),
        vat_total = esc(&data.vat_total_eur),
        total = esc(&data.total_eur),
        tax_note = tax_note_block,
    )
}

// ────────────────────────────────────────────────────────────────────────
// Typst World — in-memory single source + bundled default fonts.
// ────────────────────────────────────────────────────────────────────────

/// Process-wide font cache: loading + parsing the bundled fonts once.
fn shared_fonts() -> &'static (Vec<Font>, Prehashed<FontBook>) {
    static FONTS: OnceLock<(Vec<Font>, Prehashed<FontBook>)> = OnceLock::new();
    FONTS.get_or_init(|| {
        let mut fonts = Vec::new();
        for data in typst_assets::fonts() {
            let bytes = Bytes::from(data.to_vec());
            let mut index = 0;
            while let Some(font) = Font::new(bytes.clone(), index) {
                fonts.push(font);
                index += 1;
            }
        }
        let book = FontBook::from_fonts(&fonts);
        (fonts, Prehashed::new(book))
    })
}

struct TypstWorld {
    library: Prehashed<Library>,
    source: Source,
}

impl TypstWorld {
    fn new(source_text: String) -> Self {
        Self {
            library: Prehashed::new(Library::builder().build()),
            source: Source::detached(source_text),
        }
    }
}

impl World for TypstWorld {
    fn library(&self) -> &Prehashed<Library> {
        &self.library
    }

    fn book(&self) -> &Prehashed<FontBook> {
        &shared_fonts().1
    }

    fn main(&self) -> Source {
        self.source.clone()
    }

    fn source(&self, id: FileId) -> FileResult<Source> {
        if id == self.source.id() {
            Ok(self.source.clone())
        } else {
            Err(FileError::NotFound(id.vpath().as_rootless_path().into()))
        }
    }

    fn file(&self, id: FileId) -> FileResult<Bytes> {
        Err(FileError::NotFound(id.vpath().as_rootless_path().into()))
    }

    fn font(&self, index: usize) -> Option<Font> {
        shared_fonts().0.get(index).cloned()
    }

    fn today(&self, _offset: Option<i64>) -> Option<Datetime> {
        None
    }
}

/// Tiny per-temp-file id — avoids pulling in the full `uuid` crate just for a
/// 12-char marker.
fn uuid_like() -> String {
    let r1: u64 = fastrand::u64(..);
    let r2: u32 = fastrand::u32(..);
    format!("{r1:016x}{r2:08x}")
}

const TEMP_PDF_PREFIXES: [&str; 2] = ["warehouse14-invoice-", "warehouse14-preview-"];

/// DSGVO cleanup (Phase 3.8): delete every stale warehouse14 invoice/preview PDF
/// left in the OS temp dir. `print_a4` removes its own temp on success, but a
/// crash between write and remove — and EVERY `open_pdf_preview` (whose file is
/// held open by an external viewer, so it can't be deleted inline) — leaves a
/// temp PDF carrying a customer name + §25a data. Called at startup (purges the
/// previous session's orphans) and exposed as a command for the Art.17 erase
/// flow. Returns the number of files removed. Never panics.
pub fn sweep_stale_pdf_temp_files() -> usize {
    let dir = std::env::temp_dir();
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return 0;
    };
    let mut removed = 0usize;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let is_ours = TEMP_PDF_PREFIXES.iter().any(|p| name.starts_with(p));
        if is_ours && name.ends_with(".pdf") && std::fs::remove_file(entry.path()).is_ok() {
            removed += 1;
        }
    }
    removed
}

/// Sweep stale invoice/preview temp PDFs (DSGVO). Callable from the Art.17 flow
/// so an erase purges any at-rest PDF for the customer immediately, not just at
/// the next launch.
#[tauri::command]
pub fn sweep_temp_pdfs() -> usize {
    sweep_stale_pdf_temp_files()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compiles_minimal_document_to_pdf_bytes() {
        let bytes = compile_typst_to_pdf("= Hello".to_string()).expect("typst should compile");
        assert!(bytes.starts_with(b"%PDF-"), "output should be a PDF");
    }

    #[test]
    fn builds_and_compiles_a_full_invoice() {
        let data = InvoiceData {
            invoice_number: "W14-2026-0001".to_string(),
            date: "29.05.2026".to_string(),
            seller_name: "Warehouse14 GmbH".to_string(),
            items: vec![InvoiceItem {
                description: "Goldring 585 \"Vintage\"".to_string(),
                quantity: 1,
                unit_price_eur: "249,00".to_string(),
                vat_rate: "".to_string(),
                total_eur: "249,00".to_string(),
            }],
            subtotal_eur: "249,00".to_string(),
            vat_total_eur: "0,00".to_string(),
            total_eur: "249,00".to_string(),
            tax_note: Some("Differenzbesteuerung nach §25a UStG.".to_string()),
        };
        let pdf = compile_typst_to_pdf(build_invoice_source(&data)).expect("invoice compiles");
        assert!(pdf.starts_with(b"%PDF-"));
    }

    #[test]
    fn sweep_removes_stale_invoice_and_preview_temps_but_not_foreign_files() {
        let dir = std::env::temp_dir();
        // Unique suffix so a concurrent run of this test can't fight over names.
        let tag = uuid_like();
        let invoice = dir.join(format!("warehouse14-invoice-{tag}.pdf"));
        let preview = dir.join(format!("warehouse14-preview-{tag}.pdf"));
        let foreign = dir.join(format!("warehouse14-keepme-{tag}.txt"));
        std::fs::write(&invoice, b"customer name + 25a data").unwrap();
        std::fs::write(&preview, b"customer name + 25a data").unwrap();
        std::fs::write(&foreign, b"not ours").unwrap();

        let removed = sweep_stale_pdf_temp_files();

        assert!(removed >= 2, "should remove at least our two temp PDFs");
        assert!(!invoice.exists(), "stale invoice PDF must be purged");
        assert!(!preview.exists(), "stale preview PDF must be purged");
        assert!(foreign.exists(), "a non-warehouse14 file must be left untouched");
        let _ = std::fs::remove_file(&foreign);
    }
}
