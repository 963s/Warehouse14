//! Printer mocks — both ESC/POS and lpr A4. Just log + sleep; CI will
//! `cat` the bytes if it ever needs to assert on them.

use crate::commands::pdf::PrintA4Params;
use crate::commands::thermal::{ThermalEndpoint, ThermalReceiptData};
use crate::error::HwResult;
use crate::mock;

pub async fn print_thermal(_endpoint: ThermalEndpoint, data: ThermalReceiptData) -> HwResult<()> {
    mock::mock_delay(650).await;
    mock::maybe_inject_failure("ESC/POS thermal print (mock)")?;
    eprintln!(
        "warehouse14-pos[mock]: thermal print → receipt {} ({} items, total {} EUR)",
        data.receipt_locator,
        data.items.len(),
        data.total_eur,
    );
    Ok(())
}

pub async fn print_a4(params: PrintA4Params) -> HwResult<()> {
    mock::mock_delay(800).await;
    mock::maybe_inject_failure("A4 print (mock)")?;
    eprintln!(
        "warehouse14-pos[mock]: A4 print → {} ({} bytes)",
        params.printer_name,
        params.pdf_bytes.len(),
    );
    Ok(())
}
