export type GatewayPluginContext = {
  directory: string;
  worktree: string;
};

export type GatewayPluginHooks = {
  tool?: Record<string, unknown>;
};

/**
 * Minimal plugin scaffold that will later load the BoltFFI-generated gateway binding
 * and register OpenCode custom tools.
 */
export async function OpencodeGatewayPlugin(
  _context: GatewayPluginContext,
): Promise<GatewayPluginHooks> {
  return {
    tool: {},
  };
}

export default OpencodeGatewayPlugin;
