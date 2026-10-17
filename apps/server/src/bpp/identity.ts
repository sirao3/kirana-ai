export const BPP_ID = "kiranaai-bpp";

/** This BPP's identity for callback contexts. */
export function bppIdentity(selfBaseUrl: string) {
  return { bppId: BPP_ID, bppUri: `${selfBaseUrl.replace(/\/$/, "")}/bpp` };
}
