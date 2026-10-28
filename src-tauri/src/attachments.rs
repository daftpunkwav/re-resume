//! Attachment bytes for the conversation surface.
//!
//! Responsibilities:
//! - Store, read, delete and list the files under `<app config>/attachments`
//! - Refuse any storage name that is not a plain file name under that directory
//! - Write through a temporary sibling so a failed write never leaves a partial
//!   attachment behind
//!
//! Contracts:
//! - `write_attachment_file(storageName, bytes)` stores the bytes under the
//!   name the caller supplies and returns nothing on success.
//! - `read_attachment_file(storageName)` returns the bytes, or a message when
//!   the name is invalid or no file is stored.
//! - `delete_attachment_file(storageName)` removes the file and treats an
//!   already-missing file as success: the orphan sweep retries.
//! - `list_attachment_files()` returns the stored attachment names, sorted, and
//!   an empty list when nothing was written yet.
//!
//! Constraints:
//! - The webview holds no file-system write permission. These commands are the
//!   only write path for attachment bytes, and every path is resolved from the
//!   application config directory plus a validated file name; a caller cannot
//!   name a directory.
//! - The storage contract of the TypeScript layer names files `<id>.<ext>`
//!   with no path separator. The extension whitelist is enforced here as well,
//!   so a row naming an executable cannot be stored even if a caller is wrong.
//! - The byte layout is the caller's; this module never interprets the content.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::Manager;

/// Directory under the application config directory that holds attachment bytes.
const ATTACHMENTS_DIRECTORY: &str = "attachments";

/// Extensions the attachment domain allows. Kept in sync with
/// `domain/conversation/Attachment.ts`; a name outside this list is refused.
const ALLOWED_EXTENSIONS: [&str; 5] = ["jpg", "png", "webp", "gif", "pdf"];

/// Upper bound on a storage name. The generated names are far shorter; the bound
/// keeps a long name from becoming a filesystem-specific failure.
const MAX_STORAGE_NAME_LENGTH: usize = 160;

/// Largest attachment this store accepts, in bytes. The application validates the
/// same ceiling before it calls here; the command repeats it so a caller directly
/// on the IPC boundary cannot fill the disk with one attachment.
const MAX_ATTACHMENT_BYTE_SIZE: usize = 5 * 1024 * 1024;

/// Distinguishes the temporary files of one write from the next, so two writes
/// cannot choose the same temporary name.
static NEXT_TEMPORARY_SUFFIX: AtomicU64 = AtomicU64::new(0);

/// Resolves the attachment directory under the application config directory.
///
/// The directory is not created until a write needs it: a fresh install with no
/// attachments should not gain an empty folder merely by booting.
fn attachments_directory<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    let config_directory = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("cannot resolve the application config directory: {error}"))?;
    Ok(config_directory.join(ATTACHMENTS_DIRECTORY))
}

/// Stores attachment bytes under a validated storage name.
#[tauri::command(async)]
pub fn write_attachment_file<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    storage_name: String,
    bytes: Vec<u8>,
) -> Result<(), String> {
    write_attachment(&attachments_directory(&app)?, &storage_name, &bytes)
}

/// Reads the bytes of one stored attachment.
#[tauri::command(async)]
pub fn read_attachment_file<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    storage_name: String,
) -> Result<Vec<u8>, String> {
    read_attachment(&attachments_directory(&app)?, &storage_name)
}

/// Removes one stored attachment; a missing file is not an error.
#[tauri::command(async)]
pub fn delete_attachment_file<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    storage_name: String,
) -> Result<(), String> {
    delete_attachment(&attachments_directory(&app)?, &storage_name)
}

/// Lists the stored attachment names, sorted.
#[tauri::command(async)]
pub fn list_attachment_files<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<String>, String> {
    list_attachments(&attachments_directory(&app)?)
}

/// Rejects anything that is not a plain `<name>.<allowed extension>` file name.
///
/// The check is deliberately stricter than "contains no separator": a drive
/// letter, a traversal segment, a leading dot or a control character is refused
/// as well, so a name that passed can only ever name a file directly inside the
/// attachment directory.
pub(crate) fn validate_storage_name(storage_name: &str) -> Result<(), String> {
    if storage_name.is_empty() {
        return Err("the attachment storage name is empty".to_string());
    }
    if storage_name.len() > MAX_STORAGE_NAME_LENGTH {
        return Err(format!(
            "the attachment storage name exceeds {MAX_STORAGE_NAME_LENGTH} bytes"
        ));
    }
    if storage_name
        .chars()
        .any(|character| character.is_control() || matches!(character, '/' | '\\' | ':' | '\0'))
    {
        return Err(format!(
            "the attachment storage name {storage_name:?} contains a path separator or control character"
        ));
    }
    if storage_name.starts_with('.') || storage_name.contains("..") {
        return Err(format!(
            "the attachment storage name {storage_name:?} is not a plain file name"
        ));
    }
    let (stem, extension) = storage_name
        .rsplit_once('.')
        .ok_or_else(|| format!("the attachment storage name {storage_name:?} has no extension"))?;
    if stem.is_empty() {
        return Err(format!(
            "the attachment storage name {storage_name:?} has an empty stem"
        ));
    }
    if !stem
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.'))
    {
        return Err(format!(
            "the attachment storage name {storage_name:?} contains characters this store does not generate"
        ));
    }
    if !ALLOWED_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str()) {
        return Err(format!(
            "the attachment storage name {storage_name:?} has an unsupported extension"
        ));
    }
    Ok(())
}

/// Validates the name and joins it to the attachment directory.
fn attachment_path(directory: &Path, storage_name: &str) -> Result<PathBuf, String> {
    validate_storage_name(storage_name)?;
    Ok(directory.join(storage_name))
}

/// Writes the bytes through a temporary file and renames it into place.
///
/// The rename is the only step that publishes the file, so a failed write never
/// leaves a partial attachment. The name belongs to one identifier, so a repeat
/// write replaces the previous bytes rather than merging with them.
fn write_attachment(directory: &Path, storage_name: &str, bytes: &[u8]) -> Result<(), String> {
    let destination = attachment_path(directory, storage_name)?;
    if bytes.len() > MAX_ATTACHMENT_BYTE_SIZE {
        return Err(format!(
            "the attachment is {} bytes; the store accepts at most {MAX_ATTACHMENT_BYTE_SIZE}",
            bytes.len()
        ));
    }
    fs::create_dir_all(directory).map_err(|error| {
        format!(
            "cannot create the attachment directory {}: {error}",
            directory.display()
        )
    })?;
    let temporary = temporary_path(directory, storage_name)?;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|error| {
            format!(
                "cannot create the temporary attachment file {}: {error}",
                temporary.display()
            )
        })?;
    // Durability matters for an attachment the database row already names: the
    // rename must publish bytes that reached the disk, not only a directory entry.
    let written = file.write_all(bytes).and_then(|()| file.sync_all());
    // Windows refuses to rename a file that is still open.
    drop(file);
    if let Err(failure) = written {
        return Err(discard_temporary(&temporary, failure));
    }
    // A repeated write for one identifier replaces the file. Windows cannot
    // rename over an existing file, so the destination is removed first; the
    // window between the two operations leaves the attachment absent rather
    // than torn, which the row's own retry can repair.
    if destination.exists() {
        fs::remove_file(&destination).map_err(|error| {
            discard_temporary(
                &temporary,
                std::io::Error::new(
                    error.kind(),
                    format!("cannot replace {}: {error}", destination.display()),
                ),
            )
        })?;
    }
    if let Err(failure) = fs::rename(&temporary, &destination) {
        return Err(discard_temporary(&temporary, failure));
    }
    Ok(())
}

/// Reads the bytes of one stored attachment.
fn read_attachment(directory: &Path, storage_name: &str) -> Result<Vec<u8>, String> {
    let path = attachment_path(directory, storage_name)?;
    fs::read(&path).map_err(|error| {
        format!(
            "cannot read the attachment file {}: {error}",
            path.display()
        )
    })
}

/// Removes one stored attachment, treating an absent file as success.
fn delete_attachment(directory: &Path, storage_name: &str) -> Result<(), String> {
    let path = attachment_path(directory, storage_name)?;
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "cannot remove the attachment file {}: {error}",
            path.display()
        )),
    }
}

/// Lists the valid attachment names in the directory, sorted.
///
/// Invalid names and temporary files are skipped rather than reported: the
/// orphan sweep deletes by storage name and must never be handed a name that is
/// not a stored attachment.
fn list_attachments(directory: &Path) -> Result<Vec<String>, String> {
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => {
            return Err(format!(
                "cannot list the attachment directory {}: {error}",
                directory.display()
            ));
        }
    };
    let mut names = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|error| {
            format!(
                "cannot read an entry of the attachment directory {}: {error}",
                directory.display()
            )
        })?;
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if validate_storage_name(&name).is_err() {
            continue;
        }
        names.push(name);
    }
    names.sort();
    Ok(names)
}

/// The temporary sibling a write goes through. It carries the process id, the
/// clock and a counter so a stale file from an earlier run cannot collide with
/// this write.
fn temporary_path(directory: &Path, storage_name: &str) -> Result<PathBuf, String> {
    let sequence = NEXT_TEMPORARY_SUFFIX.fetch_add(1, Ordering::Relaxed);
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("the system clock is before the Unix epoch: {error}"))?
        .as_nanos();
    Ok(directory.join(format!(
        "{storage_name}.{}.{timestamp}.{sequence}.part",
        std::process::id()
    )))
}

/// Removes the temporary file a failed write left behind.
fn discard_temporary(temporary: &Path, failure: std::io::Error) -> String {
    match fs::remove_file(temporary) {
        Ok(()) => format!("the attachment write failed: {failure}"),
        Err(cleanup) => format!(
            "the attachment write failed ({failure}) and the temporary file {} could not be removed: {cleanup}",
            temporary.display()
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        delete_attachment, list_attachments, read_attachment, validate_storage_name,
        write_attachment,
    };
    use std::fs;
    use std::path::PathBuf;
    use std::sync::Arc;
    use std::thread;

    fn temporary_directory(name: &str) -> PathBuf {
        let directory = std::env::temp_dir().join(format!("re-resume-attachments-{name}"));
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(&directory).expect("temporary directory");
        directory
    }

    /// Names the store generates for the five supported MIME types.
    const VALID_NAMES: [&str; 5] = [
        "1f0c9a1e-2b44-4f7a-9d30-8b0e6b7a1c22.jpg",
        "preview-3.png",
        "USER_ATTACHMENT-1.webp",
        "a.b.gif",
        "resume_export.pdf",
    ];

    /// Names that must never be joined to the attachment directory. Kept as one
    /// table so a new escape shape is one line to add.
    const INVALID_NAMES: [&str; 14] = [
        "",
        ".",
        "..",
        "../escape.png",
        "..\\escape.png",
        "nested/file.png",
        "nested\\file.png",
        "C:\\temp\\capture.png",
        "/etc/passwd.png",
        ".hidden.png",
        "no-extension",
        "executable.exe",
        "name with space.png",
        "a..b.png",
    ];

    #[test]
    fn accepts_every_name_the_attachment_layer_generates() {
        for name in VALID_NAMES {
            validate_storage_name(name).unwrap_or_else(|error| panic!("{name}: {error}"));
        }
    }

    #[test]
    fn refuses_names_that_could_leave_the_attachment_directory() {
        for name in INVALID_NAMES {
            assert!(
                validate_storage_name(name).is_err(),
                "expected {name:?} to be refused"
            );
        }
    }

    #[test]
    fn writes_reads_and_deletes_one_attachment() {
        let directory = temporary_directory("round-trip");
        let name = "capture-1.png";

        write_attachment(&directory, name, b"first capture").expect("write");
        assert_eq!(
            read_attachment(&directory, name).expect("read"),
            b"first capture"
        );
        assert_eq!(
            list_attachments(&directory).expect("list"),
            vec![name.to_string()]
        );

        delete_attachment(&directory, name).expect("delete");
        assert!(read_attachment(&directory, name).is_err());
        assert!(
            list_attachments(&directory)
                .expect("list after delete")
                .is_empty()
        );
        fs::remove_dir_all(directory).expect("cleanup");
    }

    #[test]
    fn writing_the_same_name_twice_keeps_one_file_with_the_newest_bytes() {
        let directory = temporary_directory("dedupe");
        let name = "capture-1.png";

        write_attachment(&directory, name, b"first").expect("first write");
        write_attachment(&directory, name, b"second").expect("second write");

        assert_eq!(read_attachment(&directory, name).expect("read"), b"second");
        assert_eq!(
            list_attachments(&directory).expect("list"),
            vec![name.to_string()]
        );
        fs::remove_dir_all(directory).expect("cleanup");
    }

    #[test]
    fn deleting_a_missing_attachment_succeeds() {
        let directory = temporary_directory("delete-missing");

        delete_attachment(&directory, "never-stored.png").expect("missing delete is success");
        delete_attachment(&directory, "never-stored.png").expect("repeated delete is success");
        fs::remove_dir_all(directory).expect("cleanup");
    }

    #[test]
    fn listing_skips_temporary_and_foreign_files() {
        let directory = temporary_directory("listing");
        fs::write(directory.join("capture-1.png"), b"kept").expect("write valid");
        fs::write(directory.join("capture-1.png.123.5.part"), b"partial").expect("write partial");
        fs::write(directory.join("notes.txt"), b"foreign").expect("write foreign");
        fs::write(directory.join(".hidden.png"), b"hidden").expect("write hidden");

        assert_eq!(
            list_attachments(&directory).expect("list"),
            vec!["capture-1.png".to_string()]
        );
        fs::remove_dir_all(directory).expect("cleanup");
    }

    #[test]
    fn a_traversal_name_cannot_write_outside_the_directory() {
        let root = temporary_directory("traversal");
        let directory = root.join("attachments");
        fs::create_dir_all(&directory).expect("nested directory");

        for name in INVALID_NAMES {
            assert!(
                write_attachment(&directory, name, b"escape").is_err(),
                "expected {name:?} to be refused"
            );
        }
        assert!(!root.join("escape.png").exists());
        assert!(!root.join("nested").join("file.png").exists());
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn refuses_a_payload_above_the_single_attachment_ceiling() {
        let directory = temporary_directory("oversized");
        let bytes = vec![0_u8; super::MAX_ATTACHMENT_BYTE_SIZE + 1];

        assert!(write_attachment(&directory, "capture-1.png", &bytes).is_err());
        assert!(list_attachments(&directory).expect("list").is_empty());
        fs::remove_dir_all(directory).expect("cleanup");
    }

    #[test]
    fn concurrent_writes_to_distinct_names_all_land() {
        let directory = Arc::new(temporary_directory("concurrent"));
        let mut handles = Vec::new();
        for index in 0..8 {
            let directory = Arc::clone(&directory);
            handles.push(thread::spawn(move || {
                let name = format!("capture-{index}.png");
                write_attachment(&directory, &name, format!("bytes-{index}").as_bytes())
                    .expect("concurrent write");
            }));
        }
        for handle in handles {
            handle.join().expect("thread");
        }

        let names = list_attachments(&directory).expect("list");
        assert_eq!(names.len(), 8);
        assert_eq!(
            read_attachment(&directory, "capture-3.png").expect("read"),
            b"bytes-3"
        );
        fs::remove_dir_all(directory.as_path()).expect("cleanup");
    }
}
