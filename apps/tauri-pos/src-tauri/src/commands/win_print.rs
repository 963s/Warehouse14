//! Windows raw printing + printer enumeration via the Win32 print spooler
//! (winspool). The macOS/Linux path shells out to CUPS (`lpr -o raw` / `lpstat`);
//! Windows has no `lpr`, so we drive the spooler directly:
//!
//!   • `print_raw` opens the queue, starts a doc with the **"RAW"** datatype (so
//!     the driver does NOT re-render our ESC/POS control bytes), writes the
//!     bytes, and closes — the spooler owns the USB transport.
//!   • `list_printers` / `detect_receipt` enumerate installed queues with
//!     `EnumPrintersW` (level 2 → name + port) and auto-pick the USB receipt
//!     printer by port + name keyword (SRP-350 / BIXOLON / Receipt / POS / …),
//!     so the cashier just plugs it in — same behaviour as the macOS auto-detect.
//!
//! These functions are synchronous + blocking (the spooler API is); callers wrap
//! them in `tokio::task::spawn_blocking`. This whole module is `cfg(windows)`.

use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Graphics::Printing::{
    ClosePrinter, EndDocPrinter, EndPagePrinter, EnumPrintersW, OpenPrinterW, StartDocPrinterW,
    StartPagePrinter, WritePrinter, DOC_INFO_1W, PRINTER_ENUM_CONNECTIONS, PRINTER_ENUM_LOCAL,
    PRINTER_HANDLE, PRINTER_INFO_2W,
};

/// UTF-16, NUL-terminated — the encoding every `...W` Win32 entry point wants.
fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

unsafe fn pwstr_to_string(p: PWSTR) -> String {
    if p.is_null() {
        return String::new();
    }
    p.to_string().unwrap_or_default()
}

/// Send raw ESC/POS bytes to a named Windows print queue via the spooler with
/// the "RAW" datatype. Returns a German-friendly error string on any failure.
pub fn print_raw(printer_name: &str, bytes: &[u8]) -> Result<(), String> {
    let name = wide(printer_name);
    let mut hprinter = PRINTER_HANDLE::default();
    unsafe {
        OpenPrinterW(PCWSTR(name.as_ptr()), &mut hprinter, None)
            .map_err(|e| format!("Drucker '{printer_name}' nicht erreichbar: {e}"))?;
    }

    // Everything between Open and Close must run so the handle is always closed.
    let res = (|| -> Result<(), String> {
        let mut datatype = wide("RAW");
        let mut docname = wide("Warehouse14 Bon");
        let doc = DOC_INFO_1W {
            pDocName: PWSTR(docname.as_mut_ptr()),
            pOutputFile: PWSTR::null(),
            pDatatype: PWSTR(datatype.as_mut_ptr()),
        };
        unsafe {
            let job = StartDocPrinterW(hprinter, 1, &doc);
            if job == 0 {
                return Err("StartDocPrinter fehlgeschlagen".into());
            }
            StartPagePrinter(hprinter)
                .ok()
                .map_err(|e| format!("StartPagePrinter: {e}"))?;
            let mut written: u32 = 0;
            WritePrinter(
                hprinter,
                bytes.as_ptr() as *const core::ffi::c_void,
                bytes.len() as u32,
                &mut written,
            )
            .ok()
            .map_err(|e| format!("WritePrinter: {e}"))?;
            EndPagePrinter(hprinter)
                .ok()
                .map_err(|e| format!("EndPagePrinter: {e}"))?;
            EndDocPrinter(hprinter)
                .ok()
                .map_err(|e| format!("EndDocPrinter: {e}"))?;
            if written as usize != bytes.len() {
                return Err(format!(
                    "WritePrinter schrieb {written}/{} Bytes",
                    bytes.len()
                ));
            }
        }
        Ok(())
    })();

    unsafe {
        let _ = ClosePrinter(hprinter);
    }
    res
}

/// Enumerate installed printers as `(name, port)`. Best-effort — returns empty
/// on any spooler error (a perfectly valid "no printers" state for the UI).
pub fn list_printers() -> Vec<(String, String)> {
    let flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
    let mut needed: u32 = 0;
    let mut returned: u32 = 0;
    unsafe {
        // First call sizes the buffer (it "fails" with ERROR_INSUFFICIENT_BUFFER).
        let _ = EnumPrintersW(flags, PCWSTR::null(), 2, None, &mut needed, &mut returned);
        if needed == 0 {
            return Vec::new();
        }
        let mut buf = vec![0u8; needed as usize];
        if EnumPrintersW(
            flags,
            PCWSTR::null(),
            2,
            Some(&mut buf),
            &mut needed,
            &mut returned,
        )
        .is_err()
        {
            return Vec::new();
        }
        let infos = buf.as_ptr() as *const PRINTER_INFO_2W;
        let mut out = Vec::with_capacity(returned as usize);
        for i in 0..returned as isize {
            let info = &*infos.offset(i);
            out.push((
                pwstr_to_string(info.pPrinterName),
                pwstr_to_string(info.pPortName),
            ));
        }
        out
    }
}

/// Just the queue names — for `list_system_printers` (the Gerätemanager dropdown).
pub fn list_printer_names() -> Vec<String> {
    list_printers().into_iter().map(|(name, _)| name).collect()
}

/// True iff a queue with this exact name is installed.
pub fn queue_exists(printer_name: &str) -> bool {
    list_printers().iter().any(|(name, _)| name == printer_name)
}

const HINTS: [&str; 12] = [
    "srp-350", "srp", "bixolon", "receipt", "beleg", "bon", "pos", "thermal", "epson", "star",
    "kasse", "tm-",
];

/// Auto-detect the most likely USB receipt printer by port + name keyword.
pub fn detect_receipt() -> Option<String> {
    let printers = list_printers();
    let is_usb = |port: &str| port.to_lowercase().contains("usb");

    // 1. A USB-port printer whose name reads like a receipt printer — best signal.
    for (name, port) in &printers {
        if is_usb(port) && HINTS.iter().any(|h| name.to_lowercase().contains(h)) {
            return Some(name.clone());
        }
    }
    // 2. Any printer whose name reads like a receipt printer (some show a virtual port).
    for (name, _) in &printers {
        if HINTS.iter().any(|h| name.to_lowercase().contains(h)) {
            return Some(name.clone());
        }
    }
    // 3. The only USB printer present must be the one.
    let usb: Vec<&(String, String)> = printers.iter().filter(|(_, p)| is_usb(p)).collect();
    if usb.len() == 1 {
        return Some(usb[0].0.clone());
    }
    None
}
