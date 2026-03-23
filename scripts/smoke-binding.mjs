import { loadGatewayBindingModule } from "../packages/opencode-plugin/src/binding.ts"

const module = await loadGatewayBindingModule()
if (typeof module.gatewayStatus !== "function") {
    throw new Error("gatewayStatus export is unavailable")
}
if (typeof module.nextCronRunAt !== "function") {
    throw new Error("nextCronRunAt export is unavailable")
}
if (typeof module.normalizeCronTimeZone !== "function") {
    throw new Error("normalizeCronTimeZone export is unavailable")
}
if (typeof module.prepareInboundExecution !== "function") {
    throw new Error("prepareInboundExecution export is unavailable")
}
if (typeof module.ExecutionHandle?.progressive !== "function") {
    throw new Error("ExecutionHandle progressive constructor is unavailable")
}

module.gatewayStatus()
module.normalizeCronTimeZone("Asia/Shanghai")
module.nextCronRunAt(
    {
        id: "nightly",
        schedule: "0 9 * * *",
        prompt: "Summarize work",
        deliveryChannel: null,
        deliveryTarget: null,
        deliveryTopic: null,
    },
    1_735_689_600_000,
    "UTC",
)
const prepared = module.prepareInboundExecution({
    deliveryTarget: {
        channel: "telegram",
        target: "42",
        topic: null,
    },
    sender: "telegram:7",
    body: "hello",
})
module.ExecutionHandle.progressive(prepared, "ses_smoke", 400)
