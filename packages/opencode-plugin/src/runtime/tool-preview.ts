import type { TextDeliveryPreview, TextDeliverySession } from "../delivery/text"
import type { TelegramToolSection } from "../telegram/tool-render"

type PreviewSessionLike = Pick<TextDeliverySession, "mode" | "preview">

export class GatewayToolOverlayPreviewSession implements PreviewSessionLike {
    readonly mode: PreviewSessionLike["mode"]
    private latestPreview: TextDeliveryPreview | null = null
    private latestToolSections: TelegramToolSection[] = []
    private pendingWork = Promise.resolve()

    constructor(private readonly base: PreviewSessionLike) {
        this.mode = base.mode
    }

    async preview(preview: TextDeliveryPreview): Promise<void> {
        this.latestPreview = preview
        await this.enqueueFlush()
    }

    async setToolSections(sections: TelegramToolSection[]): Promise<void> {
        this.latestToolSections = sections
        await this.enqueueFlush()
    }

    private async enqueueFlush(): Promise<void> {
        const run = async (): Promise<void> => {
            await this.flush()
        }

        this.pendingWork = this.pendingWork.then(run, run)
        await this.pendingWork
    }

    private async flush(): Promise<void> {
        await this.base.preview({
            processText: this.latestPreview?.processText ?? null,
            reasoningText: this.latestPreview?.reasoningText ?? null,
            answerText: this.latestPreview?.answerText ?? null,
            toolSections: this.latestToolSections,
            forceStreamOpen: this.latestToolSections.length > 0,
        })
    }
}
