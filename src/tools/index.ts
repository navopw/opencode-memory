import type { PluginContext } from "../context.ts"
import { forgetTool } from "./forget.ts"
import { listTool } from "./list.ts"
import { recallTool } from "./recall.ts"
import { saveTool } from "./save.ts"
import { updateTool } from "./update.ts"

export const createTools = (ctx: PluginContext) => ({
	memory_save: saveTool(ctx),
	memory_recall: recallTool(ctx),
	memory_list: listTool(ctx),
	memory_update: updateTool(ctx),
	memory_forget: forgetTool(ctx),
})
