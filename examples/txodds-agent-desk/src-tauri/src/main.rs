// The desk is deliberately an empty shell: no commands, no IPC, no keys. All data and all actions
// go over HTTP to the kit's existing services (proxy :8801, feed :4000, watcher :4600), so the
// desktop app can never drift from what the web demo and the run ledger already speak.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running TxODDS Agent Desk");
}
