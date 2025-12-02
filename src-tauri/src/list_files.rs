use crate::constants::{is_binary_extension, should_exclude_dir};
use ignore::{WalkBuilder, WalkParallel, WalkState};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::channel;
use std::sync::Arc;

/// Default maximum number of files to return
const DEFAULT_MAX_FILES: usize = 1000;

fn normalize_seps(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

#[tauri::command]
pub fn list_project_files(
    directory_path: String,
    recursive: Option<bool>,
    max_depth: Option<usize>,
    max_files: Option<usize>,
) -> Result<String, String> {
    let root = PathBuf::from(&directory_path);
    if !root.exists() {
        return Err("Directory does not exist".into());
    }

    let recursive = recursive.unwrap_or(false);
    let limit = max_files.unwrap_or(DEFAULT_MAX_FILES);
    let file_count = Arc::new(AtomicUsize::new(0));

    let mut builder = WalkBuilder::new(&root);
    builder
        .hidden(true) // skip hidden files/dirs by default
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .follow_links(false);

    // Depth control: if not recursive, only list immediate children (depth 1)
    if !recursive {
        builder.max_depth(Some(1));
    } else if let Some(d) = max_depth {
        builder.max_depth(Some(d));
    }

    // Additional fast directory pruning similar to TS shouldSkipDirectory
    builder.filter_entry(|e| {
        if let Some(name) = e.file_name().to_str() {
            if e.depth() == 0 {
                return true;
            }
            if let Some(ft) = e.file_type() {
                if ft.is_dir() {
                    if name.starts_with('.') || should_exclude_dir(name) {
                        return false;
                    }
                }
            }
        }
        true
    });

    let (tx, rx) = channel();
    let walker: WalkParallel = builder.build_parallel();

    walker.run(|| {
        let tx = tx.clone();
        let root_clone = root.clone();
        let count = Arc::clone(&file_count);
        Box::new(move |result| {
            // Check if we've reached the limit
            if count.load(Ordering::Relaxed) >= limit {
                return WalkState::Quit;
            }

            match result {
                Ok(entry) => {
                    // Skip root itself
                    if entry.depth() == 0 {
                        return WalkState::Continue;
                    }

                    let path = entry.path().to_path_buf();
                    let file_type = match entry.file_type() { Some(ft) => ft, None => return WalkState::Continue };
                    let is_dir = file_type.is_dir();

                    // Filter binary files
                    if !is_dir {
                        if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
                            if is_binary_extension(ext) {
                                return WalkState::Continue;
                            }
                        }
                    }

                    // Compute group key (parent relative path)
                    let rel = match path.strip_prefix(&root_clone) { Ok(p) => p, Err(_) => path.as_path() };
                    let parent = rel.parent().unwrap_or(Path::new(""));
                    let group_key = normalize_seps(parent);
                    let name = entry.file_name().to_string_lossy().to_string();

                    // Increment counter and send tuple to collector
                    count.fetch_add(1, Ordering::Relaxed);
                    let _ = tx.send((group_key, name, is_dir));
                }
                Err(_) => {}
            }
            WalkState::Continue
        })
    });

    drop(tx);

    // Collector aggregates results into groups
    let mut groups: BTreeMap<String, (Vec<String>, Vec<String>)> = BTreeMap::new();
    while let Ok((group_key, name, is_dir)) = rx.recv() {
        let entry = groups.entry(group_key).or_insert_with(|| (Vec::new(), Vec::new()));
        if is_dir {
            entry.0.push(name);
        } else {
            entry.1.push(name);
        }
    }

    // Format output
    let mut lines: Vec<String> = Vec::new();
    for (key, (mut dirs, mut files)) in groups.into_iter() {
        if dirs.is_empty() && files.is_empty() {
            continue;
        }
        dirs.sort_unstable();
        files.sort_unstable();
        let mut all = Vec::with_capacity(dirs.len() + files.len());
        all.extend(dirs);
        all.extend(files);
        let label = if key.is_empty() { "dirs".to_string() } else { format!("{} dirs", key) };
        lines.push(format!("{}: {}", label, all.join("; ")));
    }

    Ok(lines.join("\n\n"))
}
