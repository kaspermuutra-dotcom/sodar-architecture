/**
 * Property structure and the tour manifest.
 *
 * property → floors → rooms → capture sessions/positions → panorama nodes and
 * 3D reconstructions, connected by transitions (doorway hotspots). Provisional
 * links are machine suggestions (adjacent rooms in capture order); confirmed
 * links were placed by the person who scanned, by pointing at the doorway in
 * the panorama. Both are preserved; the manifest marks which is which.
 */
export type TourNode = { id: string; name: string; floor?: string; panorama: string; panoramaProvenance: "captured" | "mixed" | "ai_generated"; thumbnail?: string; splat?: { url: string; format: "ply" | "splat" | "spz" | "zip"; provider: "kiri" | "marble"; provenance: "captured" | "ai_generated" } | null };

export type TourLink = { from: string; to: string; yaw: number; pitch: number; label?: string; confirmed: boolean; reverseYaw?: number };

export type TourManifest = { schema_version: "tour.v1"; scanId: string; propertyName?: string; startNodeId: string; floors: Array<{ id: string; label: string; roomIds: string[] }>; nodes: TourNode[]; links: TourLink[]; generatedAt: string; disclosure: { aiCompletedRooms: string[]; generativeWorlds: string[] } };

export type LinkInput = { fromRoomId: string; toRoomId: string; yaw: number; pitch: number; label?: string; confirmed: boolean; reverseYaw?: number };

export const normalizeYaw = (yaw: number) => ((yaw % 360) + 360) % 360;

/** Adjacent rooms in capture order are probably connected: suggest a link each way, unconfirmed. */
export function provisionalLinks(roomIds: string[]): LinkInput[] {
  const links: LinkInput[] = [];
  for (let i = 0; i + 1 < roomIds.length; i++) {
    links.push({ fromRoomId: roomIds[i], toRoomId: roomIds[i + 1], yaw: 0, pitch: -5, confirmed: false });
    links.push({ fromRoomId: roomIds[i + 1], toRoomId: roomIds[i], yaw: 180, pitch: -5, confirmed: false });
  }
  return links;
}

/** Confirmed links win over provisional ones for the same (from, to) pair. */
export function mergeLinks(provisional: LinkInput[], confirmed: LinkInput[]): LinkInput[] {
  const byPair = new Map<string, LinkInput>();
  for (const link of provisional) byPair.set(`${link.fromRoomId}>${link.toRoomId}`, link);
  for (const link of confirmed) byPair.set(`${link.fromRoomId}>${link.toRoomId}`, { ...link, confirmed: true });
  return [...byPair.values()];
}

export function buildTour(input: { scanId: string; propertyName?: string; rooms: Array<{ id: string; name: string; ordinal: number; floor?: string; panorama: string; panoramaProvenance: TourNode["panoramaProvenance"]; thumbnail?: string; splat?: TourNode["splat"]; generativeWorld?: boolean }>; links: LinkInput[]; now?: Date }): TourManifest | null {
  const rooms = [...input.rooms].sort((a, b) => a.ordinal - b.ordinal);
  if (!rooms.length) return null;
  const ids = new Set(rooms.map((room) => room.id));
  const floorsMap = new Map<string, string[]>();
  for (const room of rooms) {
    const key = room.floor ?? "ground";
    floorsMap.set(key, [...(floorsMap.get(key) ?? []), room.id]);
  }
  const links: TourLink[] = input.links
    .filter((link) => ids.has(link.fromRoomId) && ids.has(link.toRoomId) && link.fromRoomId !== link.toRoomId)
    .map((link) => ({ from: link.fromRoomId, to: link.toRoomId, yaw: normalizeYaw(link.yaw), pitch: Math.max(-89, Math.min(89, link.pitch)), label: link.label ?? rooms.find((room) => room.id === link.toRoomId)?.name, confirmed: link.confirmed, reverseYaw: link.reverseYaw === undefined ? undefined : normalizeYaw(link.reverseYaw) }));
  return {
    schema_version: "tour.v1",
    scanId: input.scanId,
    propertyName: input.propertyName,
    startNodeId: rooms[0].id,
    floors: [...floorsMap.entries()].map(([label, roomIds]) => ({ id: label, label, roomIds })),
    nodes: rooms.map((room) => ({ id: room.id, name: room.name, floor: room.floor, panorama: room.panorama, panoramaProvenance: room.panoramaProvenance, thumbnail: room.thumbnail, splat: room.splat ?? null })),
    links,
    generatedAt: (input.now ?? new Date()).toISOString(),
    disclosure: { aiCompletedRooms: rooms.filter((room) => room.panoramaProvenance !== "captured").map((room) => room.id), generativeWorlds: rooms.filter((room) => room.generativeWorld).map((room) => room.id) },
  };
}

export type TourProblem = { code: "no_nodes" | "bad_start" | "dangling_link" | "self_link" | "unreachable" | "duplicate_node" | "bad_angle"; nodeId?: string; detail?: string };

export function validateTour(tour: TourManifest): TourProblem[] {
  const problems: TourProblem[] = [];
  if (!tour.nodes.length) return [{ code: "no_nodes" }];
  const ids = new Set<string>();
  for (const node of tour.nodes) {
    if (ids.has(node.id)) problems.push({ code: "duplicate_node", nodeId: node.id });
    ids.add(node.id);
  }
  if (!ids.has(tour.startNodeId)) problems.push({ code: "bad_start", nodeId: tour.startNodeId });
  const adjacency = new Map<string, string[]>();
  for (const link of tour.links) {
    if (link.from === link.to) problems.push({ code: "self_link", nodeId: link.from });
    if (!ids.has(link.from) || !ids.has(link.to)) problems.push({ code: "dangling_link", detail: `${link.from}>${link.to}` });
    if (!Number.isFinite(link.yaw) || link.yaw < 0 || link.yaw >= 360 || Math.abs(link.pitch) > 89) problems.push({ code: "bad_angle", detail: `${link.from}>${link.to}` });
    adjacency.set(link.from, [...(adjacency.get(link.from) ?? []), link.to]);
  }
  if (ids.has(tour.startNodeId) && tour.nodes.length > 1) {
    const seen = new Set<string>([tour.startNodeId]);
    const queue = [tour.startNodeId];
    while (queue.length) for (const next of adjacency.get(queue.shift()!) ?? []) if (!seen.has(next)) (seen.add(next), queue.push(next));
    for (const id of ids) if (!seen.has(id)) problems.push({ code: "unreachable", nodeId: id });
  }
  return problems;
}

/** Photo Sphere Viewer virtual-tour nodes from a manifest. */
export function toPsvNodes(tour: TourManifest) {
  return tour.nodes.map((node) => ({
    id: node.id,
    panorama: node.panorama,
    name: node.name,
    thumbnail: node.thumbnail,
    links: tour.links.filter((link) => link.from === node.id).map((link) => ({ nodeId: link.to, position: { yaw: `${link.yaw}deg`, pitch: `${link.pitch}deg` }, name: link.label, data: { confirmed: link.confirmed } })),
  }));
}
