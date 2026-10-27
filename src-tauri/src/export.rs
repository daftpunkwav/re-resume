//! Grants the file system plugin the directory an export is written into.
//!
//! Responsibilities:
//! - Extend the plugin's runtime scope with the directory a chosen export
//!   destination is in, so the temporary file the export writes through is
//!   reachable
//!
//! Constraints:
//! - The grant is derived from a path the save dialog granted. A destination
//!   the user did not choose grants nothing, so the webview cannot widen the
//!   plugin's reach on its own.
//! - The grant reaches the immediate files of that directory and nothing
//!   deeper.

use std::path::Path;

use tauri::AppHandle;
use tauri_plugin_fs::FsExt;

/// Grants the file system plugin the directory the export destination is in.
///
/// The save dialog grants the destination file itself. An export writes
/// through a temporary file beside the destination, and no grant covers that
/// sibling unless the directory is granted as well.
#[tauri::command]
pub fn allow_export_directory(app: AppHandle, destination: String) -> Result<(), String> {
    let scope = app.fs_scope();
    let destination_path = Path::new(&destination);
    // A destination the dialog did not grant is not the user's choice, and
    // granting its directory would widen the plugin's reach on the webview's
    // own initiative. The static scope may still cover the destination and
    // the temporary file beside it.
    if !scope.is_allowed(destination_path) {
        return Ok(());
    }
    let Some(directory) = destination_path.parent() else {
        return Err(format!("the export destination {destination} has no directory"));
    };
    // The plugin resolves a path before it matches it against the scope, so
    // the grant is made for the resolved directory.
    let resolved = std::fs::canonicalize(directory).map_err(|error| error.to_string())?;
    scope
        .allow_directory(resolved, false)
        .map_err(|error| error.to_string())
}
