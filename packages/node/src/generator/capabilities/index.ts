export { listTargets } from "../../schemas.js";
import {
  TARGET_CAPABILITY_MANIFESTS,
  type TargetBehaviorCapability,
  type TargetCapabilityManifest,
} from "../../generated/capabilities.js";
import { assertBehaviorId, type BehaviorId } from "../behaviors.js";
import type { Target } from "../../types.js";

export type { TargetBehaviorCapability, TargetCapabilityManifest };

export function getTargetCapabilities(target: Target): TargetCapabilityManifest {
  const manifest = TARGET_CAPABILITY_MANIFESTS[target];
  if (!manifest) {
    throw new Error(`Unknown generator target: ${target}`);
  }
  return manifest;
}

export function getBehaviorCapability(
  target: Target,
  behavior: BehaviorId,
): TargetBehaviorCapability {
  assertBehaviorId(behavior);
  const manifest = getTargetCapabilities(target);
  const capability = manifest.behaviors[behavior];
  if (!capability) {
    throw new Error(`Missing capability for ${target}:${behavior}`);
  }
  return capability;
}
