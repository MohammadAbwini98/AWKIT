/**
 * Header-only GGUF files for the L8b.2 static-stage verifiers: magic, version, counts, key/values and
 * tensor infos, with no tensor data. The pinned runtime's reader parses them like a real model's header.
 */

type Kv = [key: string, type: "u32" | "str", value: number | string];

export function ggufHeader(options: { version?: number; kv: Kv[]; tensors?: { name: string; type: number }[]; kvCount?: bigint }): Buffer {
  const u32 = (n: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n);
    return b;
  };
  const u64 = (n: number | bigint) => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt(n));
    return b;
  };
  const str = (s: string) => {
    const bytes = Buffer.from(s, "utf8");
    return Buffer.concat([u64(bytes.length), bytes]);
  };
  const tensors = options.tensors ?? [{ name: "token_embd.weight", type: 0 }];
  const parts = [Buffer.from("GGUF", "latin1"), u32(options.version ?? 3), u64(tensors.length), u64(options.kvCount ?? BigInt(options.kv.length))];
  for (const [key, type, value] of options.kv) {
    parts.push(str(key), type === "u32" ? Buffer.concat([u32(4), u32(value as number)]) : Buffer.concat([u32(8), str(value as string)]));
  }
  for (const tensor of tensors) parts.push(str(tensor.name), u32(1), u64(32), u32(tensor.type), u64(0));
  return Buffer.concat(parts);
}

export const CHATML = "{% for message in messages %}<|im_start|>{{ message.role }}\n{{ message.content }}<|im_end|>\n{% endfor %}";
export const LLAMA3 = "{% for message in messages %}<|start_header_id|>{{ message.role }}<|end_header_id|>\n\n{{ message.content }}<|eot_id|>{% endfor %}";

/** A model header: by default a compatible ChatML qwen2 with a 32K context, 28 layers and known tensor types. */
export function modelHeader(o: { arch?: string; context?: number; blocks?: number; template?: string | null; version?: number; tensors?: { name: string; type: number }[] } = {}): Buffer {
  const arch = o.arch ?? "qwen2";
  const kv: Kv[] = [
    ["general.architecture", "str", arch],
    [`${arch}.context_length`, "u32", o.context ?? 32768],
    [`${arch}.block_count`, "u32", o.blocks ?? 28]
  ];
  if (o.template !== null) kv.push(["tokenizer.chat_template", "str", o.template ?? CHATML]);
  return ggufHeader({ version: o.version, kv, tensors: o.tensors ?? [{ name: "token_embd.weight", type: 0 }, { name: "blk.0.attn_q.weight", type: 12 }] });
}
