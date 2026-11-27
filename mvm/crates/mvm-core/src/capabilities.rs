use std::collections::BTreeSet;

use crate::bytecode::MbcModule;
use crate::errors::MvmError;

/// Canonical known capabilities in the Manifest Virtual Machine.
const KNOWN_CAPABILITIES: &[&str] = &[
    "pure",
    "console",
    "time",
    "fs",
    "fs.read",
    "fs.write",
    "net",
    "net.get",
    "net.post",
    "net.http",
    "db",
    "db.read",
    "db.write",
    "db.query",
    "crypto",
    "crypto.hash",
    "env",
    "process",
];

pub fn is_valid_capability_name(cap: &str) -> bool {
    if cap.is_empty() {
        return false;
    }
    cap.split('.').all(|seg| {
        !seg.is_empty()
            && seg
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
    })
}

pub fn is_known_capability(cap: &str) -> bool {
    is_valid_capability_name(cap) && KNOWN_CAPABILITIES.contains(&cap)
}

/// Returns `true` iff `held` legally authorizes `required`.
///
/// Security invariants:
/// - Both capabilities must be valid, registered capabilities (unknown capabilities are denied by default).
/// - Exact match is allowed (`fs.read` covers `fs.read`).
/// - Explicit parent-to-child delegation is allowed along dot segment boundaries
///   (`fs` covers `fs.read` and `fs.write`; `net` covers `net.get`, `net.post`, `net.http`;
///   `db` covers `db.read`, `db.write`, `db.query`; `crypto` covers `crypto.hash`).
/// - Child capabilities NEVER cover parent capabilities (`fs.read` does NOT cover `fs`).
/// - Sibling capabilities NEVER cover each other (`fs.read` does NOT cover `fs.write`).
/// - Partial identifier prefixes NEVER match (`fs_extra` does NOT cover `fs` or `fs.read`).
pub fn capability_covers(held: &str, required: &str) -> bool {
    if !is_known_capability(held) || !is_known_capability(required) {
        return false;
    }
    if held == required {
        return true;
    }
    matches!(
        (held, required),
        ("fs", "fs.read")
            | ("fs", "fs.write")
            | ("net", "net.get")
            | ("net", "net.post")
            | ("net", "net.http")
            | ("db", "db.read")
            | ("db", "db.write")
            | ("db", "db.query")
            | ("crypto", "crypto.hash")
    )
}

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
        let granted = caps
            .into_iter()
            .map(Into::into)
            .filter(|c| is_known_capability(c))
            .collect();
        Self {
            granted,
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
        let cap_str = cap.into();
        if is_known_capability(&cap_str) {
            self.granted.insert(cap_str);
        }
    }

    pub fn revoke(&mut self, cap: &str) {
        self.granted.remove(cap);
    }

    pub fn is_granted(&self, cap: &str) -> bool {
        if !is_known_capability(cap) {
            return false;
        }
        if self.allow_all_declared {
            return true;
        }
        self.granted.iter().any(|held| capability_covers(held, cap))
    }

    pub fn check_invocation(
        &self,
        module: &MbcModule,
        capability: &str,
        operation: &str,
    ) -> Result<(), MvmError> {
        if capability == "pure" {
            return Ok(());
        }

        if !is_known_capability(capability) {
            return Err(MvmError::CapabilityDenied {
                capability: capability.to_string(),
                operation: operation.to_string(),
                reason: format!("Unknown or malformed capability '{}'", capability),
            });
        }

        // 1. Module `denies` always wins unconditionally
        for denied in &module.denies {
            if capability_covers(denied, capability) {
                return Err(MvmError::CapabilityDenied {
                    capability: capability.to_string(),
                    operation: operation.to_string(),
                    reason: format!(
                        "Module '{}' explicitly denies '{}'",
                        module.module_name, denied
                    ),
                });
            }
        }

        // 2. Module `requires` check (privileged capabilities or explicit `requires` list)
        let is_privileged = capability != "console";
        if is_privileged || !module.requires.is_empty() {
            let declared = module
                .requires
                .iter()
                .any(|req| capability_covers(req, capability));
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parent_grants_child_but_child_never_grants_parent() {
        assert!(capability_covers("fs", "fs"));
        assert!(capability_covers("fs", "fs.read"));
        assert!(capability_covers("fs", "fs.write"));

        // Escalation checks
        assert!(!capability_covers("fs.read", "fs"));
        assert!(!capability_covers("fs.write", "fs"));
        assert!(!capability_covers("net.http", "net"));

        // Sibling checks
        assert!(!capability_covers("fs.read", "fs.write"));
        assert!(!capability_covers("fs.write", "fs.read"));

        // Prefix / unknown capability checks
        assert!(!capability_covers("fs_extra", "fs.read"));
        assert!(!capability_covers("fs", "fs_extra"));
        assert!(!capability_covers("unknown.cap", "unknown.cap"));
        assert!(!capability_covers("", "fs"));
    }

    #[test]
    fn host_policy_enforces_hierarchy_without_escalation() {
        let read_only = CapabilityPolicy::with_granted(["fs.read"]);
        assert!(read_only.is_granted("fs.read"));
        assert!(!read_only.is_granted("fs"));
        assert!(!read_only.is_granted("fs.write"));

        let full_fs = CapabilityPolicy::with_granted(["fs"]);
        assert!(full_fs.is_granted("fs"));
        assert!(full_fs.is_granted("fs.read"));
        assert!(full_fs.is_granted("fs.write"));
        assert!(!full_fs.is_granted("net"));
    }
}
