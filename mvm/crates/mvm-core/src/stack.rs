use crate::errors::MvmError;
use crate::value::Value;

pub struct OperandStack {
    items: Vec<Value>,
    max_capacity: usize,
}

impl OperandStack {
    pub fn new(max_capacity: usize) -> Self {
        Self {
            items: Vec::with_capacity(64),
            max_capacity,
        }
    }

    pub fn push(&mut self, val: Value, fn_name: &str) -> Result<(), MvmError> {
        if self.items.len() >= self.max_capacity {
            return Err(MvmError::StackOverflow {
                function: fn_name.to_string(),
                limit: self.max_capacity,
            });
        }
        self.items.push(val);
        Ok(())
    }

    pub fn pop(&mut self, fn_name: &str, offset: usize) -> Result<Value, MvmError> {
        self.items.pop().ok_or_else(|| MvmError::StackUnderflow {
            function: fn_name.to_string(),
            offset,
        })
    }

    pub fn peek(&self, fn_name: &str, offset: usize) -> Result<&Value, MvmError> {
        self.items.last().ok_or_else(|| MvmError::StackUnderflow {
            function: fn_name.to_string(),
            offset,
        })
    }

    pub fn len(&self) -> usize {
        self.items.len()
    }

    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    pub fn truncate(&mut self, len: usize) {
        self.items.truncate(len);
    }
}
