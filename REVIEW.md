# Review guidance

- For remote lookups that determine a write or checkout target, treat errors and unknown states as failures. Do not convert lookup failures into “not found” and proceed with a default branch or potentially stale content; fail closed and preserve retry behavior so existing data is not overwritten or lost.
