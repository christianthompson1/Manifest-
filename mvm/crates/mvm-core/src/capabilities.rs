use std::collections::BTreeSet;

use crate::bytecode::MbcModule;
use crate::errors::MvmError;

#[derive(Debug, Clone)]
pub struct CapabilityPolicy {
    granted: BTreeSet<String>,
    allow_all_declared: bool,
}

impl CapabilityPolicy {
    /// Default sandboxed policy: grants `console` unless explicitly revoked,
    /// and requires explicit host grant for privileged capabilities (`fs`, `net`, `db`, `time`, `crypto`, `env`).
    pub fn sandboxed_default() -> Self {
        let mut granted = BTreeSet::new();
        granted.insert("console".to_string());
        Self {
            granted,
            allow_all_declared: false,
        }
    }

    pub fn with_granted<I, S>(caps: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        Self {
            granted: caps.into_iter().map(Into::into).collect(),
            allow_all_declared: false,
        }
    }

    pub fn permissive_for_declared() -> Self {
        Self {
            granted: BTreeSet::new(),
            allow_all_declared: true,
        }
    }

    pub fn grant(&mut self, cap: impl Into<String>) {
        self.granted.insert(cap.into());
    }

    pub fn revoke(&mut self, cap: &str) {
        self.granted.remove(cap);
    }

    pub fn is_granted(&self, cap: &str) -> bool {
        if self.allow_all_declared {
            return true;
        }
        if self.granted.contains(cap) {
            return true;
        }
        // Hierarchical prefix check: granting `fs` grants `fs.read` and `fs.write`
        if let Some((prefix, _)) = cap.split_once('.') {
            if self.granted.contains(prefix) {
                return true;
            }
        }
        false
    }

    pub fn check_invocation(
        &self,
        module: &MbcModule,
        capability: &str,
        operation: &str,
    ) -> Result<(), MvmError> {
        if capability.is_empty() || capability == "pure" {
            return Ok(());
        }

        // 1. Module `denies` always wins unconditionally
        for denied in &module.denies {
            if capability == denied || capability.starts_with(&format!("{}.", denied)) {
                return Err(MvmError::CapabilityDenied {
                    capability: capability.to_string(),
                    operation: operation.to_string(),
                    reason: format!("Module '{}' explicitly denies '{}'", module.module_name, denied),
                });
            }
        }

        // 2. Module `requires` check (privileged capabilities or explicit `requires` list)
        let is_privileged = capability != "console";
        if is_privileged || !module.requires.is_empty() {
            let declared = module.requires.iter().any(|req| {
                req == capability
                    || capability.starts_with(&format!("{}.", req))
                    || req.starts_with(&format!("{}.", capability))
            });
            if !declared {
                return Err(MvmError::CapabilityDenied {
                    capability: capability.to_string(),
                    operation: operation.to_string(),
                    reason: format!(
                        "Module '{}' did not declare '{}' in requires",
                        module.module_name, capability
                    ),
                });
            }
        }

        // 3. Runtime host grant check
        if !self.is_granted(capability) {
            return Err(MvmError::CapabilityDenied {
                capability: capability.to_string(),
                operation: operation.to_string(),
                reason: "Host runtime did not grant this capability".to_string(),
            });
        }

        Ok(())
    }
}
