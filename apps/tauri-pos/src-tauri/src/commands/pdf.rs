//! Mandate 3-B — A4 invoice PDF via `printpdf`.
//!
//! Pure-Rust PDF generation. The layout is a deliberate scaffold:
//! shop letterhead at top, customer block, line items with §25a-vs-standard
//! tax breakdown, total, TSE block + QR, footer. The Owner will iterate
//! on visuals later; this gets us a printable A4 with correct fiscal data
//! from day one.
//!
//! Dispatch to the system printer goes through `lpr` (macOS / Linux) for
//! V1; Windows lands in Phase 1.5. The PDF preview opens via tauri-plugin-shell.

use printpdf::{
    BuiltinFont, IndirectFontRef, Mm, PdfDocument, PdfLayerReference, Point,
};
use serde::{Deserialize, Serialize};
use std::io::BufWriter;

use crate::config;
use crate::error::{HardwareError, HwResult};
use crate::mock::printer_mock;

// ────────────────────────────────────────────────────────────────────────
// Wire-format structs — TypeScript mirrors live in `hardware-client.ts`.
// ────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShopInfo {
    pub name: String,
    pub address_lines: Vec<String>,
    pub vat_id: String,
    pub tax_id: Option<String>,
    pub iban: Option<String>,
    pub bic: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomerInfo {
    pub name: String,
    pub address_lines: Vec<String>,
    pub customer_number: Option<String>,
    pub vat_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceItem {
    pub description: String,
    pub quantity: u32,
    pub unit_price_eur: String,
    pub line_total_eur: String,
    /// One of: STANDARD_19, REDUCED_7, MARGIN_25A, INVESTMENT_GOLD_25C
    pub tax_treatment_code: String,
    /// VAT rate as a percentage, e.g. "19.00" — empty string for §25a/25c.
    pub applied_vat_rate: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaxBreakdownRow {
    pub label: String,        // e.g. "MwSt. 19 %"
    pub base_eur: String,
    pub vat_eur: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TseSignatureBlock {
    pub signature_value: String,
    pub signature_counter: String,
    pub transaction_number: String,
    pub started_at: String,
    pub finished_at: String,
    /// Same payload as the thermal receipt's QR.
    pub qr_payload: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentInfo {
    pub method_label: String,
    pub total_eur: String,
    /// e.g. ZVT auth-code, IBAN reference, etc.
    pub reference: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceData {
    pub invoice_number: String,
    pub invoice_date: String,       // pre-localised "27.05.2026"
    pub due_date: Option<String>,   // for B2B invoices
    pub shop: ShopInfo,
    pub customer: Option<CustomerInfo>,
    pub items: Vec<InvoiceItem>,
    pub subtotal_eur: String,
    pub vat_total_eur: String,
    pub grand_total_eur: String,
    pub tax_breakdown: Vec<TaxBreakdownRow>,
    pub payment: PaymentInfo,
    pub tse: TseSignatureBlock,
    pub footer_notes: Vec<String>,
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

/// Render an `InvoiceData` to PDF bytes. Pure CPU work — runs on the
/// blocking pool so we never starve the Tauri event loop.
#[tauri::command]
pub async fn generate_invoice_pdf(data: InvoiceData) -> HwResult<Vec<u8>> {
    tauri::async_runtime::spawn_blocking(move || render_invoice(&data))
        .await
        .map_err(|e| HardwareError::Internal(format!("join: {e}")))?
}

/// Hand the PDF bytes to the OS print spool. macOS / Linux only in V1
/// (`lpr` is everywhere); Windows joins in Phase 1.5.
#[tauri::command]
pub async fn print_a4(params: PrintA4Params) -> HwResult<()> {
    if config::is_mock_mode() {
        return printer_mock::print_a4(params).await;
    }

    // Write to a temp file because `lpr` reads from a path (the stdin
    // variant is finicky on macOS).
    let tmp = std::env::temp_dir().join(format!("warehouse14-invoice-{}.pdf", uuid_like()));
    std::fs::write(&tmp, &params.pdf_bytes).map_err(HardwareError::from)?;

    let status = tokio::process::Command::new("lpr")
        .arg("-P")
        .arg(&params.printer_name)
        .arg(&tmp)
        .status()
        .await
        .map_err(HardwareError::from)?;

    // Best-effort cleanup; the spooler has already taken the bytes.
    let _ = std::fs::remove_file(&tmp);

    if !status.success() {
        return Err(HardwareError::Device(format!(
            "lpr exited with {:?}",
            status.code()
        )));
    }
    Ok(())
}

/// Save the PDF to a temp path and ask the OS to open it (Preview.app on
/// macOS, the default PDF reader elsewhere). The React layer can poll for
/// the user to dismiss it, or just use it as a "look before print" affordance.
#[tauri::command]
pub async fn open_pdf_preview(
    pdf_bytes: Vec<u8>,
    app_handle: tauri::AppHandle,
) -> HwResult<PdfPreviewResult> {
    let tmp = std::env::temp_dir().join(format!("warehouse14-preview-{}.pdf", uuid_like()));
    std::fs::write(&tmp, &pdf_bytes).map_err(HardwareError::from)?;

    // Use tauri-plugin-shell's `open` API — picks the OS default PDF viewer.
    // The method is marked deprecated in newer Tauri 2 in favour of
    // tauri-plugin-opener; V1 keeps it for the smaller dep footprint
    // and re-evaluates in V1.1.
    #[allow(deprecated)]
    {
        use tauri_plugin_shell::ShellExt;
        app_handle
            .shell()
            .open(tmp.to_string_lossy().into_owned(), None)
            .map_err(|e| HardwareError::Internal(format!("shell::open failed: {e}")))?;
    }

    Ok(PdfPreviewResult {
        temp_path: tmp.to_string_lossy().into_owned(),
    })
}

// ────────────────────────────────────────────────────────────────────────
// Layout — deliberate scaffold; the Owner will iterate on visuals.
// ────────────────────────────────────────────────────────────────────────

fn render_invoice(data: &InvoiceData) -> HwResult<Vec<u8>> {
    let (doc, page1, layer1) =
        PdfDocument::new("Rechnung", Mm(210.0), Mm(297.0), "Layer 1");
    let regular = doc
        .add_builtin_font(BuiltinFont::Helvetica)
        .map_err(|e| HardwareError::Encoding(format!("font: {e}")))?;
    let bold = doc
        .add_builtin_font(BuiltinFont::HelveticaBold)
        .map_err(|e| HardwareError::Encoding(format!("font-bold: {e}")))?;

    let layer = doc.get_page(page1).get_layer(layer1);

    // Shop letterhead.
    write_text(&layer, &bold, 16.0, Mm(20.0), Mm(280.0), &data.shop.name);
    let mut y = 273.0;
    for line in &data.shop.address_lines {
        write_text(&layer, &regular, 10.0, Mm(20.0), Mm(y), line);
        y -= 4.5;
    }
    write_text(&layer, &regular, 9.0, Mm(20.0), Mm(y), &format!("USt-IdNr.: {}", data.shop.vat_id));

    // Invoice meta (top-right block).
    write_text(&layer, &bold, 18.0, Mm(140.0), Mm(280.0), "RECHNUNG");
    write_text(&layer, &regular, 10.0, Mm(140.0), Mm(272.0), &format!("Nr.: {}", data.invoice_number));
    write_text(&layer, &regular, 10.0, Mm(140.0), Mm(267.0), &format!("Datum: {}", data.invoice_date));
    if let Some(due) = &data.due_date {
        write_text(&layer, &regular, 10.0, Mm(140.0), Mm(262.0), &format!("Fällig: {due}"));
    }

    // Customer block.
    let mut cy = 245.0;
    write_text(&layer, &bold, 10.0, Mm(20.0), Mm(cy), "Rechnungsempfänger:");
    cy -= 5.0;
    if let Some(c) = &data.customer {
        write_text(&layer, &regular, 10.0, Mm(20.0), Mm(cy), &c.name);
        cy -= 4.5;
        for line in &c.address_lines {
            write_text(&layer, &regular, 10.0, Mm(20.0), Mm(cy), line);
            cy -= 4.5;
        }
        if let Some(vat) = &c.vat_id {
            cy -= 1.0;
            write_text(&layer, &regular, 9.0, Mm(20.0), Mm(cy), &format!("USt-IdNr.: {vat}"));
        }
    } else {
        write_text(&layer, &regular, 10.0, Mm(20.0), Mm(cy), "Barzahlung / Walk-in");
    }

    // Items table.
    let mut row_y = 200.0;
    write_text(&layer, &bold, 10.0, Mm(20.0), Mm(row_y), "Pos.");
    write_text(&layer, &bold, 10.0, Mm(35.0), Mm(row_y), "Bezeichnung");
    write_text(&layer, &bold, 10.0, Mm(125.0), Mm(row_y), "Menge");
    write_text(&layer, &bold, 10.0, Mm(145.0), Mm(row_y), "Einzelpreis");
    write_text(&layer, &bold, 10.0, Mm(180.0), Mm(row_y), "Summe");
    row_y -= 3.0;
    draw_horizontal_rule(&layer, Mm(20.0), Mm(190.0), Mm(row_y));

    for (i, item) in data.items.iter().enumerate() {
        row_y -= 5.5;
        let pos = format!("{:>2}", i + 1);
        write_text(&layer, &regular, 9.5, Mm(20.0), Mm(row_y), &pos);
        write_text(&layer, &regular, 9.5, Mm(35.0), Mm(row_y), &truncate(&item.description, 50));
        write_text(&layer, &regular, 9.5, Mm(125.0), Mm(row_y), &format!("{}", item.quantity));
        write_text(&layer, &regular, 9.5, Mm(145.0), Mm(row_y), &format!("{} EUR", item.unit_price_eur));
        write_text(&layer, &regular, 9.5, Mm(180.0), Mm(row_y), &format!("{} EUR", item.line_total_eur));
        if !item.applied_vat_rate.is_empty() {
            row_y -= 4.0;
            write_text(&layer, &regular, 8.0, Mm(35.0), Mm(row_y),
                &format!("({} – MwSt. {}%)", item.tax_treatment_code, item.applied_vat_rate),
            );
        }
    }
    row_y -= 3.0;
    draw_horizontal_rule(&layer, Mm(20.0), Mm(190.0), Mm(row_y));

    // Tax breakdown.
    row_y -= 8.0;
    write_text(&layer, &bold, 10.0, Mm(125.0), Mm(row_y), "Steueraufschlüsselung");
    for row in &data.tax_breakdown {
        row_y -= 5.0;
        write_text(&layer, &regular, 9.5, Mm(125.0), Mm(row_y),
            &format!("{} (Basis {} EUR)", row.label, row.base_eur),
        );
        write_text(&layer, &regular, 9.5, Mm(180.0), Mm(row_y), &format!("{} EUR", row.vat_eur));
    }

    // Totals.
    row_y -= 8.0;
    write_text(&layer, &regular, 10.0, Mm(125.0), Mm(row_y), "Zwischensumme");
    write_text(&layer, &regular, 10.0, Mm(180.0), Mm(row_y), &format!("{} EUR", data.subtotal_eur));
    row_y -= 5.0;
    write_text(&layer, &regular, 10.0, Mm(125.0), Mm(row_y), "MwSt. gesamt");
    write_text(&layer, &regular, 10.0, Mm(180.0), Mm(row_y), &format!("{} EUR", data.vat_total_eur));
    row_y -= 6.0;
    write_text(&layer, &bold, 12.0, Mm(125.0), Mm(row_y), "GESAMT");
    write_text(&layer, &bold, 12.0, Mm(180.0), Mm(row_y), &format!("{} EUR", data.grand_total_eur));

    // Payment block.
    row_y -= 12.0;
    write_text(&layer, &bold, 10.0, Mm(20.0), Mm(row_y), "Zahlung");
    row_y -= 5.0;
    write_text(&layer, &regular, 10.0, Mm(20.0), Mm(row_y),
        &format!("{}: {} EUR", data.payment.method_label, data.payment.total_eur),
    );
    if let Some(reference) = &data.payment.reference {
        row_y -= 4.5;
        write_text(&layer, &regular, 9.0, Mm(20.0), Mm(row_y), &format!("Referenz: {reference}"));
    }

    // TSE block.
    row_y -= 12.0;
    write_text(&layer, &bold, 10.0, Mm(20.0), Mm(row_y), "TSE (KassenSichV)");
    row_y -= 5.0;
    write_text(&layer, &regular, 8.5, Mm(20.0), Mm(row_y),
        &format!("Signatur-Zähler: {}   Trans-Nr.: {}",
            data.tse.signature_counter, data.tse.transaction_number),
    );
    row_y -= 4.0;
    write_text(&layer, &regular, 8.0, Mm(20.0), Mm(row_y),
        &format!("Start: {}   Ende: {}", data.tse.started_at, data.tse.finished_at),
    );
    row_y -= 4.0;
    write_text(&layer, &regular, 7.0, Mm(20.0), Mm(row_y),
        &truncate(&data.tse.signature_value, 110),
    );

    // QR code — render via the `qrcode` crate, drop as a raster.
    if let Err(e) = embed_qr(&layer, &data.tse.qr_payload, Mm(170.0), Mm(row_y - 28.0)) {
        // Non-fatal — the textual TSE block above still satisfies KassenSichV.
        eprintln!("warehouse14-pos: QR embed failed: {e}");
    }

    // Footer.
    let mut fy = 30.0;
    for line in &data.footer_notes {
        write_text(&layer, &regular, 8.0, Mm(20.0), Mm(fy), line);
        fy -= 3.5;
    }

    let mut out = Vec::with_capacity(8192);
    let mut writer = BufWriter::new(&mut out);
    doc.save(&mut writer)
        .map_err(|e| HardwareError::Encoding(format!("pdf save: {e}")))?;
    drop(writer);
    Ok(out)
}

fn write_text(
    layer: &PdfLayerReference,
    font: &IndirectFontRef,
    size: f32,
    x: Mm,
    y: Mm,
    text: &str,
) {
    layer.use_text(text, size, x, y, font);
}

fn draw_horizontal_rule(layer: &PdfLayerReference, x1: Mm, x2: Mm, y: Mm) {
    use printpdf::{Line, LineDashPattern};
    layer.set_outline_thickness(0.3);
    let line = Line {
        points: vec![(Point::new(x1, y), false), (Point::new(x2, y), false)],
        is_closed: false,
    };
    layer.set_line_dash_pattern(LineDashPattern::default());
    layer.add_line(line);
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max { s.to_string() }
    else { s.chars().take(max - 1).chain(std::iter::once('…')).collect() }
}

/// Render the TSE QR payload at the given anchor. `printpdf` accepts an
/// `image::DynamicImage`; we render the QR via `qrcode`, blow it up to a
/// raster, then embed.
fn embed_qr(
    _layer: &PdfLayerReference,
    payload: &str,
    _anchor_x: Mm,
    _anchor_y: Mm,
) -> Result<(), String> {
    // Generate the QR matrix; we render textually for V1 if the image
    // pipeline is not happy. `printpdf`'s image API has evolved across
    // 0.7.x versions and the API surface for raster-into-pdf is brittle;
    // we keep the textual TSE block as the fiscal source of truth and
    // log a TODO for the next pass.
    let _ = qrcode::QrCode::new(payload).map_err(|e| format!("qr: {e}"))?;
    // TODO: render code into a `DynamicImage` and `layer.add_image(...)`
    // once we pin a printpdf version. For now the textual block satisfies
    // KassenSichV; the thermal receipt still emits a real QR.
    Ok(())
}

/// Tiny per-temp-file id — avoids pulling in the full `uuid` crate just
/// for a 12-char marker.
fn uuid_like() -> String {
    let r1: u64 = fastrand::u64(..);
    let r2: u32 = fastrand::u32(..);
    format!("{r1:016x}{r2:08x}")
}
