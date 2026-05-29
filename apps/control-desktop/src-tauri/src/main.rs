// Warehouse14 Control Desktop — Tauri 2 entry. The library `run()` owns the
// builder (single-instance guard, native tray, notifications).

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    warehouse14_control_desktop_lib::run()
}
