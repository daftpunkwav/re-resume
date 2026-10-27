//! Publishes an exported document from the native side.
//!
//! Responsibilities:
//! - Check that an export destination is covered by a dialog grant
//! - Write the bytes to a temporary file beside the destination and rename it
//!   over the destination, so a failed write leaves the previous document intact
//!
//! Contracts:
//! - `publish_export(destination, bytes)` returns nothing on success and a
//!   message describing the failure otherwise. In the export flow the
//!   destination is the path the save dialog returned; the bytes are the
//!   rendered document.
//!
//! Constraints:
//! - Nothing here extends the file system plugin's scope. The webview is not
//!   granted the destination's directory, so it cannot reach the temporary
//!   sibling, read it, replace it or remove it.
//! - The temporary file is named here, not by the caller: a name from the
//!   webview could point outside the destination's own directory.
//! - Only a destination the plugin's runtime scope already covers is written,
//!   and this command grants nothing. In the export flow that grant is the path
//!   the save dialog returned; the scope also holds what the open dialog
//!   recorded (the capability file grants it for imports), and such a path
//!   passes too. The check therefore bounds writes to paths a user picked in a
//!   dialog, not to the save dialog's choice alone.

use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::AppHandle;
use tauri_plugin_fs::FsExt;

/// Distinguishes the temporary files of one export from the next, so two
/// publications into one directory cannot choose the same name.
static NEXT_TEMPORARY_SUFFIX: AtomicU64 = AtomicU64::new(0);

/// Writes `bytes` over the export destination.
///
/// The destination must be a path the file system plugin's runtime scope
/// covers. In the export flow the save dialog recorded that path when the user
/// chose it; the open dialog records the same way, so a path it granted passes
/// as well. This command adds nothing to the scope, so it cannot widen what a
/// dialog recorded, and it must not become a write into any path the webview
/// names by itself.
///
/// The command runs on the async runtime rather than the main thread, because
/// writing a document is file I/O the event loop has no reason to wait on.
#[tauri::command(async)]
pub fn publish_export<R: tauri::Runtime>(
    app: AppHandle<R>,
    destination: String,
    bytes: Vec<u8>,
) -> Result<(), String> {
    let destination = PathBuf::from(destination);
    if !app.fs_scope().is_allowed(&destination) {
        return Err(format!(
            "the export destination {} was not granted by a file dialog",
            destination.display()
        ));
    }
    publish(&destination, &bytes)
}

/// Writes the bytes through a temporary file and renames it over the
/// destination.
///
/// Only the rename changes the destination, and a rename inside one directory
/// either happens or does not, so a write that fails partway leaves the
/// previous document intact. The temporary file is removed when either step
/// fails.
fn publish(destination: &Path, bytes: &[u8]) -> Result<(), String> {
    let temporary = temporary_path(destination)?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|error| {
            format!(
                "could not create the temporary file {}: {error}",
                temporary.display()
            )
        })?;
    // The rename must publish data that reached the disk, not only the
    // directory entry that names it.
    let written = file.write_all(bytes).and_then(|()| file.sync_all());
    // Windows refuses to rename a file that is still open; closing here also
    // releases the handle on every other platform.
    drop(file);
    if let Err(failure) = written {
        return Err(discard_temporary(&temporary, failure));
    }
    if let Err(failure) = std::fs::rename(&temporary, destination) {
        return Err(discard_temporary(&temporary, failure));
    }
    Ok(())
}

/// The temporary file an export writes through: a sibling of the destination,
/// so the rename replaces the destination on one filesystem instead of moving
/// bytes across two.
///
/// The name carries the process id, the clock and a counter, so a stale file
/// left by an earlier run and a second export cannot be mistaken for this
/// export's file. The file is created exclusively, so an existing file is never
/// overwritten even if the name did repeat.
fn temporary_path(destination: &Path) -> Result<PathBuf, String> {
    let file_name = destination.file_name().ok_or_else(|| {
        format!(
            "the export destination {} has no file name",
            destination.display()
        )
    })?;
    let directory = destination.parent().ok_or_else(|| {
        format!(
            "the export destination {} has no directory",
            destination.display()
        )
    })?;
    let sequence = NEXT_TEMPORARY_SUFFIX.fetch_add(1, Ordering::Relaxed);
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("the system clock is before the Unix epoch: {error}"))?
        .as_nanos();
    Ok(directory.join(format!(
        "{}.{}.{timestamp}.{sequence}.part",
        file_name.to_string_lossy(),
        std::process::id()
    )))
}

/// Removes the temporary file an export left behind.
///
/// A cleanup that fails is reported together with the failure that caused it:
/// the export did not happen either way, and the leftover file is what the user
/// has to know about.
fn discard_temporary(temporary: &Path, failure: std::io::Error) -> String {
    match std::fs::remove_file(temporary) {
        Ok(()) => format!("the export failed: {failure}"),
        Err(cleanup) => format!(
            "the export failed ({failure}) and the temporary file {} could not be removed: {cleanup}",
            temporary.display()
        ),
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    use super::publish;

    /// A directory of its own per test, removed when the test ends.
    struct ScratchDirectory(PathBuf);

    impl ScratchDirectory {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir()
                .join(format!("re-resume-export-{name}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).expect("the scratch directory is created");
            Self(path)
        }

        fn destination(&self) -> PathBuf {
            self.0.join("resume.pdf")
        }

        fn entries(&self) -> Vec<String> {
            let mut entries: Vec<String> = fs::read_dir(&self.0)
                .expect("the scratch directory is listed")
                .map(|entry| {
                    entry
                        .expect("the directory entry is readable")
                        .file_name()
                        .to_string_lossy()
                        .into_owned()
                })
                .collect();
            entries.sort();
            entries
        }
    }

    impl Drop for ScratchDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn replaces_an_existing_destination() {
        let scratch = ScratchDirectory::new("replace");
        let destination = scratch.destination();
        fs::write(&destination, b"previous").expect("the previous document is written");

        publish(&destination, b"next").expect("the export is published");

        assert_eq!(
            fs::read(&destination).expect("the destination is readable"),
            b"next"
        );
    }

    #[test]
    fn leaves_no_temporary_file_behind() {
        let scratch = ScratchDirectory::new("clean");

        publish(&scratch.destination(), b"next").expect("the export is published");

        assert_eq!(scratch.entries(), vec!["resume.pdf".to_string()]);
    }

    #[test]
    fn keeps_the_destination_and_removes_the_temporary_file_when_the_rename_fails() {
        let scratch = ScratchDirectory::new("rename-failure");
        let destination = scratch.destination();
        // A rename over a directory fails on every target platform.
        fs::create_dir(&destination).expect("the destination directory is created");

        let error = publish(&destination, b"next").expect_err("the rename fails");

        assert!(error.contains("the export failed"), "{error}");
        assert!(destination.is_dir());
        assert_eq!(scratch.entries(), vec!["resume.pdf".to_string()]);
    }
}
