use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};

fn sidecar_candidates(executable: &Path) -> Vec<PathBuf> {
    let directory = executable.parent().unwrap_or_else(|| Path::new("."));
    vec![
        directory.join("cmux-tui"),
        directory.join("../lib/cmux-linux/cmux-tui"),
        directory.join("../lib/cmux-linux/resources/cmux-tui"),
    ]
}

fn run_cli(arguments: &[String]) -> ExitCode {
    let executable = match std::env::current_exe() {
        Ok(path) => path,
        Err(error) => {
            eprintln!("cmux-linux: cannot locate executable: {error}");
            return ExitCode::FAILURE;
        }
    };
    let Some(sidecar) = sidecar_candidates(&executable).into_iter().find(|path| path.is_file())
    else {
        eprintln!("cmux-linux: bundled cmux-tui sidecar was not found");
        return ExitCode::FAILURE;
    };
    match Command::new(sidecar).args(arguments).status() {
        Ok(status) => ExitCode::from(status.code().unwrap_or(1) as u8),
        Err(error) => {
            eprintln!("cmux-linux: cannot run bundled CLI: {error}");
            ExitCode::FAILURE
        }
    }
}

fn main() -> ExitCode {
    let mut arguments = std::env::args().skip(1).collect::<Vec<_>>();
    if arguments.first().is_some_and(|argument| argument == "--cli") {
        arguments.remove(0);
        return run_cli(&arguments);
    }
    cmux_linux::run();
    ExitCode::SUCCESS
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cli_sidecar_search_never_targets_the_existing_cmux_command() {
        let candidates = sidecar_candidates(Path::new("/usr/bin/cmux-linux"));
        assert!(candidates.iter().all(|candidate| candidate.file_name().unwrap() == "cmux-tui"));
    }
}
