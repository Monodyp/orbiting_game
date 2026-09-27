export const GAMEPLAY_TEAM_COLORS = {
  ice: { hex: 0xffffff, css: '#FFFFFF' },
  water: { hex: 0x43c6d6, css: '#43c6d6' },
} as const;

export function gameplayTeamColor(team: 'ice' | 'water'): string {
  return GAMEPLAY_TEAM_COLORS[team].css;
}