import type { MansionRoomKey } from "../../../shared/party/night.js";

// Small line icons for the mansion board, drawn on a 24px grid in the current text colour.
const PATHS: Record<MansionRoomKey | "ballroom", string> = {
  bell_tower: "M12 3v2M7 16c0-6 1.5-10 5-10s5 4 5 10M5 16h14M10.5 19a1.5 1.5 0 0 0 3 0",
  gallery: "M4 5h16v14H4zM7 8h10v8H7zM8 15l3-4 2 2 1.5-2 2.5 4",
  library: "M5 4h4v16H5zM10 4h3v16h-3zM14.5 5.2l3-0.8 3.2 15.3-3 .8z",
  garden: "M12 20v-8M12 12c-3 0-5-2-5-5 3 0 5 2 5 5zM12 14c3 0 5-2 5-5-3 0-5 2-5 5M8 20h8",
  grand_hall: "M4 20V9l8-5 8 5v11M8 20v-6h8v6M4 20h16M12 7.5v2",
  music_room: "M9 18V6l10-2v12M9 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM19 16a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM9 9l10-2",
  terrace: "M15 4a6 6 0 1 0 5 9 5 5 0 0 1-5-9zM3 20h18M6 20v-4M18 20v-4M6 16h12",
  vault: "M4 4h16v16H4zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 9V7M15 12h2M12 15v2M9 12H7",
  post_room: "M3 7h18v12H3zM3 7l9 7 9-7",
  ballroom: "M12 3v3M8 6h8l-1 3H9zM6 12a6 6 0 0 0 12 0M9 18l-1 3M15 18l1 3",
};

export function roomIcon(key: MansionRoomKey | "ballroom"): string {
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="${PATHS[key]}"/></svg>`;
}
