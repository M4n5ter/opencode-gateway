export type GatewayStatusSnapshot = {
  runtimeMode: string;
  supportsTelegram: boolean;
  supportsCron: boolean;
  hasWebUi: boolean;
};

export type GatewayBindingModule = {
  gatewayStatus(): GatewayStatusSnapshot;
  initialized?: Promise<void>;
  default?: () => Promise<void>;
};

const GENERATED_NODE_ENTRYPOINT = new URL(
  "../../../dist/wasm/pkg/node.js",
  import.meta.url,
);

export async function loadGatewayBindingModule(): Promise<GatewayBindingModule> {
  const module = (await import(GENERATED_NODE_ENTRYPOINT.href)) as GatewayBindingModule;

  if (module.initialized) {
    await module.initialized;
  } else if (module.default) {
    await module.default();
  }

  return module;
}
