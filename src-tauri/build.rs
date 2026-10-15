// Tauri's build step: compiles the capability and permission manifests into the
// binary and writes the JSON schemas editors use for completion under
// `gen/schemas`. There is no application logic here.

fn main() {
    tauri_build::build()
}
