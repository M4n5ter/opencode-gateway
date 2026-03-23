//! OpenCode-specific execution state machine shared by wasm hosts.

mod driver;
mod types;

pub use driver::OpencodeExecutionDriver;
pub use types::{
    OpencodeCommand, OpencodeCommandError, OpencodeCommandErrorCode, OpencodeCommandPart,
    OpencodeCommandResult, OpencodeDriverStep, OpencodeExecutionInput, OpencodeMessage,
    OpencodeMessagePart, OpencodePrompt, OpencodePromptPart,
};
