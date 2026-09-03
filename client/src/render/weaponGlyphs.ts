/**
 * Tiny pewter silhouettes for the weapon tokens on the board.
 *
 * Every glyph is authored in a local coordinate box of roughly ±6.5 units, centred on the
 * origin with y pointing down, so it occupies the same 13-unit footprint as the plain circle
 * token it replaces. Three optional layers, drawn in this order:
 *
 *   thick – a stroked path for rod / loop / cord shapes (drawn dark-then-light for an outline)
 *   d     – a filled path (pewter gradient with a dark outline)
 *   lines – thin dark detail strokes drawn on top (a poison X, mortar lines, ring holes …)
 */
export interface WeaponGlyph {
  d?: string;
  thick?: string;
  lines?: string;
}

export const WEAPON_GLYPHS: Record<string, WeaponGlyph> = {
  // brass stick with a flame on top
  'weapon-candlestick': {
    d: 'M-5,6.5 L5,6.5 L3,4.5 L1.2,4.5 L1.2,0 L-1.2,0 L-1.2,4.5 L-3,4.5 Z M-1.6,0 h3.2 v-4.2 h-3.2 Z M0,-7.5 Q2,-5.3 0,-4.2 Q-2,-5.3 0,-7.5 Z',
  },
  // straight blade, cross-guard, short grip
  'weapon-dagger': {
    d: 'M0,-7 L2,-1.5 L2,0 L5,0 L5,1.5 L2,1.5 L2,3 L1.2,3 L1.2,6.5 L-1.2,6.5 L-1.2,3 L-2,3 L-2,1.5 L-5,1.5 L-5,0 L-2,0 L-2,-1.5 Z',
  },
  // fat diagonal cylinder
  'weapon-lead-pipe': {
    d: 'M-6.5,2.5 L2.5,-6.5 L6.5,-2.5 L-2.5,6.5 Z',
    lines: 'M-4.5,4.5 L4.5,-4.5',
  },
  // barrel, cylinder, grip and trigger guard
  'weapon-revolver': {
    d: 'M-6.5,-4 H6.5 V-1.5 H1 V0 H-1 L-2,1 H-5.5 V-1.5 H-6.5 Z M-4.5,-1 H-0.5 V1.5 H-4.5 Z M-4.8,1.5 H-1.2 L-2.5,6.5 H-6 Z',
    lines: 'M-1,1.5 Q-0.5,3.5 1,3',
  },
  // hangman's noose: knotted rope above a loop
  'weapon-rope': {
    thick: 'M0,-7 V-1.5 M0,-1.5 A3.9,3.9 0 1 1 -0.01,-1.5 Z',
    d: 'M-1.6,-6.2 H1.6 V-2.2 H-1.6 Z',
    lines: 'M-1.6,-5.2 H1.6 M-1.6,-4.2 H1.6 M-1.6,-3.2 H1.6 M-2.6,1.2 L-1.6,2.6 M2.6,1.2 L1.6,2.6 M0,6.3 V4.8',
  },
  // open-ended spanner on a diagonal handle
  'weapon-wrench': {
    d: 'M-6.5,4.5 L-4.5,6.5 L2,0 L0,-2 Z M1.5,-6.5 H6.5 V-5 H4.6 V-2 H6.5 V-0.5 H1.5 Q-0.8,-3.5 1.5,-6.5 Z',
  },
  // corked bottle marked with an X
  'weapon-poison': {
    d: 'M-1.5,-7 H1.5 V-5 H2.6 V-3.5 H1.5 L5,-0.5 V5 A1.5,1.5 0 0 1 3.5,6.5 H-3.5 A1.5,1.5 0 0 1 -5,5 V-0.5 L-1.5,-3.5 H-2.6 V-5 H-1.5 Z',
    lines: 'M-2.2,0.5 L2.2,4.5 M2.2,0.5 L-2.2,4.5',
  },
  // slim blade with a small decorative guard
  'weapon-letter-opener': {
    d: 'M0,-7 L1.2,-1 L1.2,1 L2.6,1.5 L2.6,2.6 L1.2,2.6 L1.6,6.5 L-1.6,6.5 L-1.2,2.6 L-2.6,2.6 L-2.6,1.5 L-1.2,1 L-1.2,-1 Z',
  },
  // rod with a ring on top and a barb at the foot
  'weapon-fire-poker': {
    d: 'M-0.8,-3.5 h1.6 v10 h-1.6 z M0.8,2.5 L4.5,0.5 L5,1.8 L0.8,4.5 Z M0,-7 A1.9,1.9 0 1 1 -0.01,-7 Z',
    lines: 'M0,-5.9 A0.8,0.8 0 1 1 -0.01,-5.9 Z',
  },
  // cushion with pinched sides and corner tassels
  'weapon-pillow': {
    d: 'M-5.5,-5.5 Q0,-4 5.5,-5.5 Q4,0 5.5,5.5 Q0,4 -5.5,5.5 Q-4,0 -5.5,-5.5 Z',
    lines: 'M-5.5,-5.5 L-6.5,-6.5 M5.5,-5.5 L6.5,-6.5 M5.5,5.5 L6.5,6.5 M-5.5,5.5 L-6.5,6.5',
  },
  // bow across the top of a vertical stock
  'weapon-crossbow': {
    thick: 'M-6.5,-2.5 Q0,-7.5 6.5,-2.5',
    d: 'M-1,-6 H1 V6.5 H-1 Z M-2.5,1 H2.5 V2.5 H-2.5 Z',
    lines: 'M-6.5,-2.5 L6.5,-2.5',
  },
  // pointed hat over a bearded body
  'weapon-garden-gnome': {
    d: 'M0,-7 L3.6,-1 L-3.6,-1 Z M-4,-1 Q-5.2,6.5 0,6.5 Q5.2,6.5 4,-1 Z',
    lines: 'M-1.5,0.5 Q0,-0.5 1.5,0.5',
  },
  // scalloped canopy over a crook handle
  'weapon-umbrella': {
    d: 'M-6.5,0 A6.5,6.5 0 0 1 6.5,0 Q5,-1 3.25,0 Q1.6,-1 0,0 Q-1.6,-1 -3.25,0 Q-5,-1 -6.5,0 Z',
    thick: 'M0,0 V4.5 A1.6,1.6 0 0 1 -3.2,4.5',
  },
  // short diagonal handle, wedge blade on the upper right
  'weapon-hatchet': {
    d: 'M-6.5,5.5 L-5,7 L1.5,-1.5 L0,-3 Z M-0.5,-3.5 L4.5,-7 L6.5,-1.8 L2.2,-1 Z',
  },
  // flanged barrel, plunger above, needle below
  'weapon-syringe': {
    d: 'M-2,-3 H2 V3 H-2 Z M-3.5,-3.8 H3.5 V-2.6 H-3.5 Z M-0.7,-7 H0.7 V-3.5 H-0.7 Z M-2,-7.5 H2 V-6.5 H-2 Z M-0.35,3 H0.35 V7 H-0.35 Z',
    lines: 'M-1,-1 H1 M-1,1 H1',
  },
  // ring, shaft, crossbar, curved arms
  'weapon-anchor': {
    thick: 'M-6,1.5 Q-5,6.5 0,6.5 Q5,6.5 6,1.5',
    d: 'M-0.8,-4 H0.8 V6.5 H-0.8 Z M-3.5,-2.6 H3.5 V-1.4 H-3.5 Z M0,-7 A1.8,1.8 0 1 1 -0.01,-7 Z M-6.8,0 L-4.4,2.4 L-6.6,3.2 Z M6.8,0 L4.4,2.4 L6.6,3.2 Z',
    lines: 'M0,-5.9 A0.7,0.7 0 1 1 -0.01,-5.9 Z',
  },
  // long shaft over a wide barrel head
  'weapon-mallet': {
    d: 'M-0.8,-7 H0.8 V2 H-0.8 Z M-6.5,2 H6.5 A1,1 0 0 1 7,3 V5.5 A1,1 0 0 1 6.5,6.5 H-6.5 A1,1 0 0 1 -7,5.5 V3 A1,1 0 0 1 -6.5,2 Z',
    lines: 'M-4.5,2 V6.5 M4.5,2 V6.5',
  },
  // crossed blades over two finger loops
  'weapon-scissors': {
    d: 'M-1.1,0.5 L-4.5,-7 L-2.8,-7 L0,-1.5 L2.8,-7 L4.5,-7 L1.1,0.5 Z M-2.6,4 A2.4,2.4 0 1 1 -2.61,4 Z M2.6,4 A2.4,2.4 0 1 1 2.59,4 Z',
    lines: 'M-2.6,4 A1.1,1.1 0 1 1 -2.61,4 Z M2.6,4 A1.1,1.1 0 1 1 2.59,4 Z',
  },
  // round pan with a handle out to the upper right
  'weapon-frying-pan': {
    d: 'M1.4,-1.2 L5.3,-6.5 L7,-5 L3,-0.2 Z M-1.6,1.5 A4.2,4.2 0 1 1 -1.61,1.5 Z',
    lines: 'M-1.6,1.5 A2.7,2.7 0 1 1 -1.61,1.5 Z',
  },
  // cup with handles, stem and plinth
  'weapon-trophy': {
    thick: 'M-4,-5 Q-7.2,-5 -5,-1 M4,-5 Q7.2,-5 5,-1',
    d: 'M-4,-6.5 H4 V-3.5 Q4,0 0,1 Q-4,0 -4,-3.5 Z M-1,1 H1 V4 H-1 Z M-3.5,4 H3.5 V6.5 H-3.5 Z',
  },
  // bar with two pairs of plates
  'weapon-barbell': {
    d: 'M-7,-0.6 H7 V0.6 H-7 Z M-5.8,-4 H-3.8 V4 H-5.8 Z M-3.6,-2.8 H-2.1 V2.8 H-3.6 Z M3.8,-4 H5.8 V4 H3.8 Z M2.1,-2.8 H3.6 V2.8 H2.1 Z',
  },
  // rounded wooden grip over a tapering spike
  'weapon-ice-pick': {
    d: 'M-2.6,-7 H2.6 A1.4,1.4 0 0 1 4,-5.6 V-2 H-4 V-5.6 A1.4,1.4 0 0 1 -2.6,-7 Z M-0.9,-2 H0.9 L0.3,7 H-0.3 Z',
  },
  // rod with finials and hanging rings
  'weapon-curtain-rod': {
    d: 'M-5,-1.2 H5 V0 H-5 Z M-5.6,-0.6 A1.6,1.6 0 1 1 -5.61,-0.6 Z M5.6,-0.6 A1.6,1.6 0 1 1 5.59,-0.6 Z',
    lines: 'M-2.8,1.6 A1.3,1.3 0 1 1 -2.81,1.6 Z M0,1.6 A1.3,1.3 0 1 1 -0.01,1.6 Z M2.8,1.6 A1.3,1.3 0 1 1 2.79,1.6 Z',
  },
  // curved blade over a round guard and diagonal grip
  'weapon-sabre': {
    d: 'M6,-7 Q8,-1 -1.2,4.2 L-2.4,3 Q5.2,-1 6,-7 Z M-2.4,2.4 A2.2,2.2 0 1 1 -2.41,2.4 Z M-2.8,3.6 L-6.5,7 L-5.6,7 L-1.9,4.4 Z',
  },
  // oblong block with mortar lines
  'weapon-brick': {
    d: 'M-6.5,-3.5 H6.5 V3.5 H-6.5 Z',
    lines: 'M-3.5,-3.5 V0 M3.5,-3.5 V0 M-6.5,0 H6.5 M0,0 V3.5',
  },
  // barbed head on a diagonal shaft
  'weapon-harpoon': {
    d: 'M-6.5,5.5 L-5.5,6.5 L3,-2 L2,-3 Z M6.5,-6.5 L1,-5 L2.5,-3.5 L3.5,-2.5 L5,-1 Z',
  },
  // boxy body, nose, grip and magazine
  'weapon-nail-gun': {
    d: 'M-6,-4.5 H4.5 V-0.5 H-6 Z M4.5,-3.5 H7 V-1.5 H4.5 Z M-4.2,-0.5 H-1 L-2,6 H-5.2 Z M2,-0.5 H4 V6.5 H2 Z',
    lines: 'M-2.5,-2.5 H1.5',
  },
  // D-grip, shaft and a rounded blade
  'weapon-shovel': {
    d: 'M0,-7 A1.9,1.9 0 1 1 -0.01,-7 Z M-0.7,-4 H0.7 V1.5 H-0.7 Z M-3.6,1 H3.6 V3.5 Q3.6,6.2 0,7 Q-3.6,6.2 -3.6,3.5 Z',
    lines: 'M0,-5.9 A0.8,0.8 0 1 1 -0.01,-5.9 Z',
  },
  // straight haft, wedge blade to the right, feather to the left
  'weapon-tomahawk': {
    d: 'M-0.7,-6 H0.7 V7 H-0.7 Z M0.7,-6.5 L6,-6 L6.5,-1 L0.7,-2 Z M-0.7,-5.2 L-3.6,-3.6 L-0.7,-3.6 Z',
  },
  // bent V with a rounded elbow
  'weapon-boomerang': {
    d: 'M-6.5,5 L-3.5,-4 Q0,-7.5 3.5,-4 L6.5,5 L4.5,5.6 L2.3,-2.4 Q0,-4.2 -2.3,-2.4 L-4.5,5.6 Z',
  },
  // three tines on a crossbar over a handle
  'weapon-pitchfork': {
    d: 'M-0.7,-1 H0.7 V7 H-0.7 Z M-4,-2.2 H4 V-0.8 H-4 Z M-4,-2.2 L-3.6,-7 L-2.8,-7 L-2.4,-2.2 Z M-0.6,-2.2 L-0.4,-7 L0.4,-7 L0.6,-2.2 Z M2.4,-2.2 L2.8,-7 L3.6,-7 L4,-2.2 Z',
  },
  // ring on top, J-shaped hook with a pointed tip
  'weapon-meat-hook': {
    thick: 'M1.5,-4 V1 A3.5,3.5 0 0 1 -5.5,1',
    d: 'M1.5,-6.5 A1.8,1.8 0 1 1 1.49,-6.5 Z M-6.6,1.6 L-5.5,-2 L-4.4,1.6 Z',
    lines: 'M1.5,-5.4 A0.7,0.7 0 1 1 1.49,-5.4 Z',
  },
  // long thin tapered stick
  'weapon-pool-cue': {
    d: 'M-6.5,5.8 L-5.5,7 L6.5,-6.2 L6,-6.7 Z',
    lines: 'M-4.6,4.5 L-3.6,5.5 M-3.4,3.4 L-2.4,4.4',
  },
  // paint tin with a wire handle and a drip
  'weapon-paint': {
    thick: 'M-3.8,-3 Q0,-8 3.8,-3',
    d: 'M-4.5,-2.5 H4.5 V6 A1,1 0 0 1 3.5,7 H-3.5 A1,1 0 0 1 -4.5,6 Z M-5,-3.5 H5 V-2 H-5 Z M2,-2 Q3.2,0 2.6,2 A0.9,0.9 0 0 1 1.4,1.6 Q1.8,0 2,-2 Z',
  },
  // shaft with a crook
  'weapon-cane': {
    thick: 'M2,7 V-3 A2.6,2.6 0 0 0 -3.2,-3 V-1.2',
  },
  // blade swung open from a slim handle
  'weapon-razor': {
    d: 'M-2.3,0.25 L0.3,1.75 L3.8,-4.3 L1.2,-5.8 Z M-1.4,0.3 L-0.6,1.7 L-5.8,4.7 L-6.6,3.3 Z M-1,1 A1.1,1.1 0 1 1 -1.01,1 Z',
    lines: 'M-0.4,0.3 L2.6,-4.9',
  },
  // diagonal rod, loop handle at the foot, diamond brand at the head
  'weapon-branding-iron': {
    d: 'M-5.5,4.5 L-4.5,5.5 L2,-1 L1,-2 Z M3.5,-7 L7,-3.5 L3.5,0 L0,-3.5 Z M-5,5 A1.9,1.9 0 1 1 -5.01,5 Z',
    lines: 'M3.5,-5 L5.5,-3.5 L3.5,-2 L1.5,-3.5 Z M-5,6.1 A0.8,0.8 0 1 1 -5.01,6.1 Z',
  },
  // stiletto shoe in profile
  'weapon-high-heels': {
    d: 'M-5.5,-4.5 Q-2,-2 2,-1 L6.5,0.5 L6.5,2 L-1,2 L-3,1.6 L-4,6.5 L-5.2,6.5 L-5.5,1.5 Z',
  },
  // glass dome on a plinth
  'weapon-snow-globe': {
    d: 'M0,-5.5 A4.5,4.5 0 1 1 -0.01,-5.5 Z M-4,3 H4 L5,6.5 H-5 Z',
    lines: 'M-2,-2.5 h0.01 M1.5,-3.5 h0.01 M0.5,0 h0.01 M-1.5,1 h0.01 M2.5,0.5 h0.01',
  },
  // long-necked bottle with a foil cap
  'weapon-champagne': {
    d: 'M-1.7,-7.5 H1.7 V-6 H-1.7 Z M-1.2,-6 H1.2 V-3 Q3.5,-1.5 3.5,1 V6 A1,1 0 0 1 2.5,7 H-2.5 A1,1 0 0 1 -3.5,6 V1 Q-3.5,-1.5 -1.2,-3 Z',
    lines: 'M-2,1.5 H2 M-2,3.5 H2',
  },
};
