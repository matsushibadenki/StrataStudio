use serde::{Deserialize, Serialize};

/// Persisted dock geometry. WebViews render this state; pointer drags are temporary previews.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Layout {
    pub engine_width: u32,
    pub api_width: u32,
    pub logs_height: u32,
}
impl Default for Layout {
    fn default() -> Self {
        Self {
            engine_width: 270,
            api_width: 300,
            logs_height: 174,
        }
    }
}
impl Layout {
    pub fn patch(&self, value: &serde_json::Value) -> Result<Self, String> {
        let fields = value.as_object().ok_or("Expected dock dimensions")?;
        if fields.is_empty()
            || fields
                .keys()
                .any(|k| !["engineWidth", "apiWidth", "logsHeight"].contains(&k.as_str()))
        {
            return Err("Unknown dock dimension".into());
        }
        let mut merged = serde_json::to_value(self).map_err(|e| e.to_string())?;
        for (key, value) in fields {
            merged[key] = value.clone();
        }
        let layout: Self = serde_json::from_value(merged).map_err(|e| e.to_string())?;
        layout.validate()?;
        Ok(layout)
    }
    pub fn validate(&self) -> Result<(), String> {
        if !(220..=480).contains(&self.engine_width)
            || !(240..=480).contains(&self.api_width)
            || !(100..=420).contains(&self.logs_height)
        {
            return Err("Dock dimensions are outside supported bounds".into());
        }
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_layout_that_can_hide_the_workspace() {
        assert!(Layout {
            engine_width: 0,
            ..Layout::default()
        }
        .validate()
        .is_err());
        assert!(Layout {
            logs_height: u32::MAX,
            ..Layout::default()
        }
        .validate()
        .is_err());
        assert!(Layout::default().validate().is_ok());
    }
    #[test]
    fn partial_updates_preserve_other_windows_dimensions() {
        let layout = Layout {
            engine_width: 340,
            ..Layout::default()
        };
        let updated = layout.patch(&serde_json::json!({"apiWidth":310})).unwrap();
        assert_eq!(updated.engine_width, 340);
        assert_eq!(updated.api_width, 310);
        assert!(updated.patch(&serde_json::json!({"typo":100})).is_err());
    }
}
