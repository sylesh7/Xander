use std::io::Result;

fn main() -> Result<()> {
    println!("cargo:rerun-if-changed=proto/sybil_shield.proto");
    prost_build::compile_protos(&["proto/sybil_shield.proto"], &["proto/"])?;
    Ok(())
}
