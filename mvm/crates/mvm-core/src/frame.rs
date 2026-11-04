use crate::value::Value;

#[derive(Debug, Clone)]
pub struct CallFrame {
    pub fn_idx: u32,
    pub pc: usize,
    pub stack_base: usize,
    pub locals: Vec<Value>,
}

impl CallFrame {
    pub fn new(fn_idx: u32, local_count: usize, stack_base: usize, args: Vec<Value>) -> Self {
        let mut locals = vec![Value::Void; local_count];
        for (i, arg) in args.into_iter().enumerate() {
            if i < locals.len() {
                locals[i] = arg;
            }
        }
        Self {
            fn_idx,
            pc: 0,
            stack_base,
            locals,
        }
    }
}
