#![forbid(unsafe_code)]

pub mod bytecode;
pub mod capabilities;
pub mod decoder;
pub mod errors;
pub mod frame;
pub mod host;
pub mod instruction;
pub mod memory;
pub mod stack;
pub mod stdlib;
pub mod value;
pub mod verifier;
pub mod vm;

pub use bytecode::MbcModule;
pub use capabilities::CapabilityPolicy;
pub use decoder::{decode_mbc, disassemble_module};
pub use errors::MvmError;
pub use host::{HostEnvironment, MemoryHostEnvironment};
pub use value::Value;
pub use verifier::verify_module;
pub use vm::{ExecutionSummary, VirtualMachine, VmLimits};

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bytecode::section_tags;
    use crate::instruction::opcodes;

    fn build_test_mbc(
        requires: &[&str],
        denies: &[&str],
        constants_i64: &[i64],
        constants_str: &[&str],
        imports: &[(&str, &str, u16, bool)],
        code: &[u8],
        local_count: u16,
        max_stack: u16,
    ) -> Vec<u8> {
        let mut const_pool_strs: Vec<String> = constants_str.iter().map(|s| s.to_string()).collect();
        let add_str = |pool: &mut Vec<String>, s: &str| -> u32 {
            if let Some(pos) = pool.iter().position(|x| x == s) {
                (constants_i64.len() + pos) as u32
            } else {
                let idx = (constants_i64.len() + pool.len()) as u32;
                pool.push(s.to_string());
                idx
            }
        };

        let main_idx = add_str(&mut const_pool_strs, "main");
        let mut import_records = Vec::new();
        for (sym, cap, arity, has_ret) in imports {
            let s_idx = add_str(&mut const_pool_strs, sym);
            let c_idx = add_str(&mut const_pool_strs, cap);
            import_records.push((s_idx, c_idx, *arity, *has_ret));
        }

        // Section 1: Module meta
        let mut sec_meta = Vec::new();
        write_str(&mut sec_meta, "test_mod");
        sec_meta.extend_from_slice(&(requires.len() as u16).to_le_bytes());
        for r in requires {
            write_str(&mut sec_meta, r);
        }
        sec_meta.extend_from_slice(&0u16.to_le_bytes());
        sec_meta.extend_from_slice(&(denies.len() as u16).to_le_bytes());
        for d in denies {
            write_str(&mut sec_meta, d);
        }

        // Section 2: Constant pool
        let mut sec_consts = Vec::new();
        let total_consts = (constants_i64.len() + const_pool_strs.len()) as u32;
        sec_consts.extend_from_slice(&total_consts.to_le_bytes());
        for n in constants_i64 {
            sec_consts.push(0x01);
            sec_consts.extend_from_slice(&n.to_le_bytes());
        }
        for s in &const_pool_strs {
            sec_consts.push(0x04);
            write_str(&mut sec_consts, s);
        }

        // Section 4: Imports
        let mut sec_imports = Vec::new();
        sec_imports.extend_from_slice(&(import_records.len() as u32).to_le_bytes());
        for (s_idx, c_idx, arity, has_ret) in import_records {
            sec_imports.extend_from_slice(&s_idx.to_le_bytes());
            sec_imports.extend_from_slice(&c_idx.to_le_bytes());
            sec_imports.extend_from_slice(&arity.to_le_bytes());
            sec_imports.push(if has_ret { 1 } else { 0 });
        }

        // Section 6: Func table
        let mut sec_funcs = Vec::new();
        sec_funcs.extend_from_slice(&0u32.to_le_bytes()); // globals
        sec_funcs.extend_from_slice(&0u32.to_le_bytes()); // entry = 0
        sec_funcs.extend_from_slice(&1u32.to_le_bytes()); // 1 fn
        sec_funcs.extend_from_slice(&main_idx.to_le_bytes());
        sec_funcs.extend_from_slice(&0u16.to_le_bytes()); // params
        sec_funcs.extend_from_slice(&local_count.to_le_bytes());
        sec_funcs.extend_from_slice(&max_stack.to_le_bytes());
        sec_funcs.push(1); // has_return
        sec_funcs.extend_from_slice(&0u16.to_le_bytes()); // effects
        sec_funcs.extend_from_slice(&0u32.to_le_bytes()); // code_offset
        sec_funcs.extend_from_slice(&(code.len() as u32).to_le_bytes());

        let sections: Vec<(u32, Vec<u8>)> = vec![
            (section_tags::MODULE_META, sec_meta),
            (section_tags::CONST_POOL, sec_consts),
            (section_tags::IMPORT_TABLE, sec_imports),
            (section_tags::FUNC_TABLE, sec_funcs),
            (section_tags::CODE, code.to_vec()),
        ];

        let mut out = Vec::new();
        out.extend_from_slice(&bytecode::MBC_MAGIC);
        out.extend_from_slice(&1u16.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&0u32.to_le_bytes());
        out.extend_from_slice(&(sections.len() as u32).to_le_bytes());

        let mut offset = 16 + sections.len() * 12;
        for (tag, data) in &sections {
            out.extend_from_slice(&tag.to_le_bytes());
            out.extend_from_slice(&(offset as u32).to_le_bytes());
            out.extend_from_slice(&(data.len() as u32).to_le_bytes());
            offset += data.len();
        }
        for (_, data) in sections {
            out.extend_from_slice(&data);
        }
        out
    }

    fn write_str(buf: &mut Vec<u8>, s: &str) {
        buf.extend_from_slice(&(s.len() as u32).to_le_bytes());
        buf.extend_from_slice(s.as_bytes());
    }

    #[test]
    fn executes_verified_arithmetic_and_loop() {
        // sum = 0; i = 1; while i <= 5 { sum = sum + i; i = i + 1 } return sum (15)
        // consts: #0 = 0, #1 = 1, #2 = 5
        let mut code = Vec::new();
        // 0x00: CONST 0; STORE_LOCAL 0 (sum) -> 5 + 3 = 8
        code.push(opcodes::CONST);
        code.extend_from_slice(&0u32.to_le_bytes());
        code.push(opcodes::STORE_LOCAL);
        code.extend_from_slice(&0u16.to_le_bytes());
        // 0x08: CONST 1; STORE_LOCAL 1 (i) -> 8 + 8 = 16 (0x10)
        code.push(opcodes::CONST);
        code.extend_from_slice(&1u32.to_le_bytes());
        code.push(opcodes::STORE_LOCAL);
        code.extend_from_slice(&1u16.to_le_bytes());
        // loop_head = 0x10 (16):
        // LOAD_LOCAL 1 (3B -> 19), CONST 2 (5B -> 24), LTE (1B -> 25), JMP_IF_FALSE end (5B -> 30)
        code.push(opcodes::LOAD_LOCAL);
        code.extend_from_slice(&1u16.to_le_bytes());
        code.push(opcodes::CONST);
        code.extend_from_slice(&2u32.to_le_bytes());
        code.push(opcodes::LTE);
        code.push(opcodes::JMP_IF_FALSE);
        let jmp_end_patch = code.len();
        code.extend_from_slice(&0u32.to_le_bytes());
        // body: LOAD_LOCAL 0; LOAD_LOCAL 1; ADD_I64; STORE_LOCAL 0
        code.push(opcodes::LOAD_LOCAL);
        code.extend_from_slice(&0u16.to_le_bytes());
        code.push(opcodes::LOAD_LOCAL);
        code.extend_from_slice(&1u16.to_le_bytes());
        code.push(opcodes::ADD_I64);
        code.push(opcodes::STORE_LOCAL);
        code.extend_from_slice(&0u16.to_le_bytes());
        // i = i + 1
        code.push(opcodes::LOAD_LOCAL);
        code.extend_from_slice(&1u16.to_le_bytes());
        code.push(opcodes::CONST);
        code.extend_from_slice(&1u32.to_le_bytes());
        code.push(opcodes::ADD_I64);
        code.push(opcodes::STORE_LOCAL);
        code.extend_from_slice(&1u16.to_le_bytes());
        // JMP loop_head (16)
        code.push(opcodes::JMP);
        code.extend_from_slice(&16u32.to_le_bytes());
        let end_off = code.len() as u32;
        code[jmp_end_patch..jmp_end_patch + 4].copy_from_slice(&end_off.to_le_bytes());
        // return sum
        code.push(opcodes::LOAD_LOCAL);
        code.extend_from_slice(&0u16.to_le_bytes());
        code.push(opcodes::RET);

        let bytes = build_test_mbc(&[], &[], &[0, 1, 5], &[], &[], &code, 2, 4);
        let mut module = decode_mbc(&bytes).expect("decode");
        verify_module(&mut module).expect("verify");

        let vm = VirtualMachine::new(VmLimits::default(), CapabilityPolicy::sandboxed_default());
        let mut host = MemoryHostEnvironment::new();
        let res = vm.execute(&module, &mut host, None).expect("execute");
        assert_eq!(res.return_value, Value::I64(15));
    }

    #[test]
    fn rejects_unverified_or_corrupt_bytecode() {
        assert_eq!(decode_mbc(b"BAD!0123456789abcdef").unwrap_err(), MvmError::InvalidMagic);

        // Stack underflow on ADD_I64 with only 1 operand
        let mut bad_code = Vec::new();
        bad_code.push(opcodes::CONST);
        bad_code.extend_from_slice(&0u32.to_le_bytes());
        bad_code.push(opcodes::ADD_I64);
        bad_code.push(opcodes::RET);

        let bytes = build_test_mbc(&[], &[], &[42], &[], &[], &bad_code, 0, 4);
        let mut module = decode_mbc(&bytes).expect("decode");
        let err = verify_module(&mut module).unwrap_err();
        assert!(matches!(err, MvmError::VerificationFailed { .. }));
    }

    #[test]
    fn traps_on_checked_i64_overflow() {
        let mut code = Vec::new();
        code.push(opcodes::CONST);
        code.extend_from_slice(&0u32.to_le_bytes());
        code.push(opcodes::CONST);
        code.extend_from_slice(&1u32.to_le_bytes());
        code.push(opcodes::ADD_I64);
        code.push(opcodes::RET);

        let bytes = build_test_mbc(&[], &[], &[i64::MAX, 1], &[], &[], &code, 0, 4);
        let mut module = decode_mbc(&bytes).expect("decode");
        verify_module(&mut module).expect("verify");

        let vm = VirtualMachine::new(VmLimits::default(), CapabilityPolicy::sandboxed_default());
        let mut host = MemoryHostEnvironment::new();
        let err = vm.execute(&module, &mut host, None).unwrap_err();
        assert!(matches!(err, MvmError::IntegerOverflow { op: "add", .. }));
    }

    #[test]
    fn enforces_capability_requires_and_host_grant() {
        // Call fs.read_text("secret.txt") -> import #0
        let mut code = Vec::new();
        code.push(opcodes::CONST);
        code.extend_from_slice(&0u32.to_le_bytes()); // "secret.txt"
        code.push(opcodes::HOST_CALL);
        code.extend_from_slice(&0u32.to_le_bytes());
        code.push(opcodes::RET);

        // 1) Module omits `fs.read` in requires -> denied even if host grants `fs.read`
        let bytes_undeclared = build_test_mbc(
            &["console"],
            &[],
            &[],
            &["secret.txt"],
            &[("fs.read_text", "fs.read", 1, true)],
            &code,
            0,
            4,
        );
        let mut mod1 = decode_mbc(&bytes_undeclared).unwrap();
        verify_module(&mut mod1).unwrap();
        let vm_granted = VirtualMachine::new(
            VmLimits::default(),
            CapabilityPolicy::with_granted(["console", "fs.read"]),
        );
        let mut host = MemoryHostEnvironment::new().with_virtual_file("secret.txt", "top-secret");
        assert!(matches!(
            vm_granted.execute(&mod1, &mut host, None).unwrap_err(),
            MvmError::CapabilityDenied { .. }
        ));

        // 2) Module declares `fs.read`, host denies -> denied at runtime
        let bytes_declared = build_test_mbc(
            &["fs.read"],
            &[],
            &[],
            &["secret.txt"],
            &[("fs.read_text", "fs.read", 1, true)],
            &code,
            0,
            4,
        );
        let mut mod2 = decode_mbc(&bytes_declared).unwrap();
        verify_module(&mut mod2).unwrap();
        let vm_sandboxed =
            VirtualMachine::new(VmLimits::default(), CapabilityPolicy::sandboxed_default());
        assert!(matches!(
            vm_sandboxed.execute(&mod2, &mut host, None).unwrap_err(),
            MvmError::CapabilityDenied { .. }
        ));

        // 3) Both module `requires` AND host policy grant `fs.read` -> succeeds!
        let ok = vm_granted.execute(&mod2, &mut host, None).unwrap();
        assert_eq!(ok.return_value, Value::Str("top-secret".to_string()));
    }

    #[test]
    fn enforces_execution_step_limit_and_div_zero() {
        // Infinite loop: 0x00: JMP 0
        let mut loop_code = Vec::new();
        loop_code.push(opcodes::JMP);
        loop_code.extend_from_slice(&0u32.to_le_bytes());

        let bytes = build_test_mbc(&[], &[], &[], &[], &[], &loop_code, 0, 2);
        let mut module = decode_mbc(&bytes).unwrap();
        verify_module(&mut module).unwrap();

        let limits = VmLimits {
            max_steps: 500,
            ..VmLimits::default()
        };
        let vm = VirtualMachine::new(limits, CapabilityPolicy::sandboxed_default());
        let mut host = MemoryHostEnvironment::new();
        assert_eq!(
            vm.execute(&module, &mut host, None).unwrap_err(),
            MvmError::ExecutionStepLimitExceeded { limit: 500 }
        );

        // Division by zero: 10 / 0
        let mut div_code = Vec::new();
        div_code.push(opcodes::CONST);
        div_code.extend_from_slice(&0u32.to_le_bytes());
        div_code.push(opcodes::CONST);
        div_code.extend_from_slice(&1u32.to_le_bytes());
        div_code.push(opcodes::DIV_I64);
        div_code.push(opcodes::RET);

        let div_bytes = build_test_mbc(&[], &[], &[10, 0], &[], &[], &div_code, 0, 4);
        let mut div_mod = decode_mbc(&div_bytes).unwrap();
        verify_module(&mut div_mod).unwrap();
        assert!(matches!(
            vm.execute(&div_mod, &mut host, None).unwrap_err(),
            MvmError::DivisionByZero { .. }
        ));
    }

    #[test]
    fn sha256_matches_nist_standard_vector() {
        assert_eq!(
            stdlib::deterministic_hash_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
