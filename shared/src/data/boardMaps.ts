// Hand-authored section maps for the mansion board. One character per tile.
//
//   letter  room tile (see ROOM_KEY)      .  hall / path       (space)  no tile (void)
//   #       elevator (3x3)                ~  water (obstacle)  ,        lawn (obstacle, soft)
//   H       hedge wall (obstacle)         F  fountain (obstacle)         x  grave / pillar (obstacle)
//   /       a room corner cut on the diagonal (obstacle; which room and which corner is in board.ts)
//
// Doors are authored in a second layer of the same shape: an arrow on a ROOM tile pointing at the
// hall (or neighbouring room) tile it opens onto:  ^ v < >
// Every other character in the door layer is ignored.
//
// House rule for halls: never an open block 3 tiles wide in BOTH directions (corridors are 1 or 2
// wide; the lift lobbies use a pillar or two to keep it that way).

export interface SectionMap {
  id: 'grounds' | 'ground-floor' | 'upper-floor' | 'basement';
  title: string;
  tiles: string[];
  doors: string[];
}

export const ROOM_KEY: Record<string, string> = {
  // grounds
  B: 'room-boat-house',
  M: 'room-hedge-maze',
  C: 'room-cemetery',
  Z: 'room-gazebo',
  S: 'room-stables',
  R: 'room-rose-garden',
  G: 'room-greenhouse',
  Y: 'room-courtyard',
  // ground floor
  V: 'room-veranda',
  T: 'room-theatre',
  A: 'room-ballroom',
  U: 'room-music',
  D: 'room-dining',
  K: 'room-kitchen',
  J: 'room-pantry',
  P: 'room-parlour',
  W: 'room-drawing',
  I: 'room-billiard',
  L: 'room-lounge',
  k: 'room-smoking',
  // upper floor
  b: 'room-library',
  s: 'room-study',
  g: 'room-gallery',
  m: 'room-master-suite',
  o: 'room-boudoir',
  c: 'room-walk-in-closet',
  t: 'room-trophy',
  d: 'room-den',
  q: 'room-clock-tower',
  l: 'room-solarium',
  p: 'room-planetarium',
  // basement
  w: 'room-wine-cellar',
  h: 'room-chapel',
  a: 'room-laboratory',
  r: 'room-armory',
  e: 'room-boiler',
  f: 'room-workshop',
  n: 'room-bunker',
  u: 'room-sauna',
  y: 'room-gymnasium',
};

// ---------------------------------------------------------------------------------------------
// THE GROUNDS  (30 x 16). Gravel paths between lawns. Cemetery (with graves) top-left, then a REAL
// Hedge Maze: two gates (west and east), hedge walls you thread round, and the clearing at its
// heart is the room. Stables and the Boat House (on the pond) top-right. Along the south, facing the
// house: the Gazebo on the west lawn, the Rose Garden, the walled Courtyard with the fountain (and
// the envelope) in its middle, and the Greenhouse beside the kitchen yard, whose far corner hides
// the cellar hatch. The bottom row is the front terrace shared with the Ground Floor.
// ---------------------------------------------------------------------------------------------
const GROUNDS_TILES = [
  'CCCCCC,HHHHHHHHH,SSSSSS,BBBB~~', // 0
  'CxCCxC,H.......H,SSSSSS.BBBB~~', // 1
  'CCCCCC.H.HMMMH.H,SSSSSS.BBBB~~', // 2
  'CxCCxC...HMMM....SSSSSS.BBBB~~', // 3   maze gates west (7,3) and east (15,3); the east way in is short
  'CCCCCC.H.HMMMH.H.SSSSSS.....~~', // 4
  ',,.....H.......H..............', // 5
  ',,.,.,.HHHHHHHHH..,,.,,.,,.,,.', // 6
  ',,............................', // 7   the long walk
  '/ZZ/.,.,,,,,,.YYYYYYYYY.GGGGGG', // 8   the octagonal Gazebo's cut corners
  'ZZZZ.,.RRRRRR.YYYYYYYYY.GGGGGG', // 9
  'ZZZZ...RRRRRR.YYFFFFYYY.GGGGGG', // 10
  '/ZZ/...RRRRRR.YYFFFFYYY.GGGGGG', // 11
  '.....,.RRRRRR.YYFFFFYYY..,,,..', // 12
  '.....,.RRRRRR.YYYYYYYYY..,,,..', // 13
  ',,,,.,.,,,.,,.,,,,.,,,,..,,,..', // 14
  '..............................', // 15  front terrace
];
const GROUNDS_DOORS = [
  '..............................', // 0
  '......................>.......', // 1  stables east
  '.....>....^...................', // 2  cemetery east, maze clearing north door (the winding way)
  '............>....<......<.v...', // 3  maze clearing east door (the short way), stables west, boat house west + south
  '.....v..............v.........', // 4  cemetery south, stables south
  '..............................', // 5
  '..............................', // 6
  '..............................', // 7
  '..^.......................^...', // 8  gazebo north, greenhouse north
  '...>...<......<.......>.......', // 9  gazebo east, rose garden west, courtyard west + east
  '..............................', // 10
  '..v.....................<...v.', // 11 gazebo south, greenhouse west + south
  '............>.................', // 12 rose garden east
  '..........v.......v...........', // 13 rose garden south, courtyard south
  '..............................', // 14
  '..............................', // 15
];

// ---------------------------------------------------------------------------------------------
// GROUND FLOOR (30 x 20). Row 0 is the terrace side (front door). A 2-wide grand hall rings the
// Ballroom in the middle of the house. Service wing top-right: Dining opens through a connecting
// door into the Kitchen, the Kitchen through another into the Pantry on its far side, the Kitchen's
// back door gives onto the service passage and the servants' stair. The lift lobby (with a pillar)
// sits beside the Lounge, clear of the grand staircase on the left seam. Lounge, Billiard Room and
// Smoking Room cluster around the back of the house.
// ---------------------------------------------------------------------------------------------
const GROUND_TILES = [
  '..............................', // 0
  '.VVVVVV.TTTTTTT.DDDDDKKKKKJJJ.', // 1
  '.VVVVVV.TTTTTTT.DDDDDKKKKKJJJ.', // 2
  '.VVVVVV.TTTTTTT.DDDDDKKKKKJJJ.', // 3
  '.VVVVVV.TTTTTTT.DDDDDKKKKK....', // 4
  '.VVVVVV.TTTTTTT.DDDDDKKKKK.x..', // 5
  '..............................', // 6
  '....###..AAAAAAAAAA..PPPPPPP..', // 7
  '..x.###..AAAAAAAAAA..PPPPPPP..', // 8
  '....###..AAAAAAAAAA..PPPPPPP..', // 9
  '.........AAAAAAAAAA..PPPPPPP..', // 10
  '..LLLLL..AAAAAAAAAA..PPPPPPP..', // 11
  '..LLLLL..AAAAAAAAAA...........', // 12
  '..LLLLL..AAAAAAAAAA..WWWWWWWW.', // 13
  '.....................WWWWWWWW.', // 14
  '..UUUUU..............WWWWWWWW.', // 15
  '..UUUUU..IIIIIIIIII...........', // 16
  '..UUUUU..IIIIIIIIII..kkkkkkk..', // 17
  '..UUUUU..IIIIIIIIII..kkkkkkk..', // 18
  '..UUUUU..IIIIIIIIII..kkkkkkk..', // 19
];
const GROUND_DOORS = [
  '..............................', // 0
  '....^.............^...........', // 1  veranda, dining onto the terrace
  '.........................>....', // 2  kitchen -> pantry (connecting door)
  '......>.......>......<.....v..', // 3  veranda east, theatre east, kitchen -> dining (connecting door), pantry south
  '..............................', // 4
  '...v....<..v......v....v......', // 5  veranda south, theatre west + south, dining + kitchen south
  '..............................', // 6
  '..............................', // 7
  '.........<....................', // 8  ballroom west
  '.....................<........', // 9  parlour west
  '..................>...........', // 10 ballroom east
  '...^....................v..>..', // 11 lounge north, parlour south + east
  '......>.......................', // 12 lounge east
  '...........v.........<......>.', // 13 ballroom south, drawing west + east
  '..............................', // 14
  '...^......................v...', // 15 music north, drawing south
  '..........^...................', // 16 billiard north
  '......>..............<.....>..', // 17 music east, smoking west + east
  '..................>...........', // 18 billiard east
  '..............................', // 19
];

// ---------------------------------------------------------------------------------------------
// UPPER FLOOR (24 x 20). The right edge faces the Ground Floor across the stair gap: the grand
// staircase lands at rows 9-11, the Clock Tower's spiral stair at row 2 (the tower wraps the well),
// the back stairs at rows 17-18. Garden-facing top edge: Solarium (garden steps down beside it) and
// the round Planetarium. Library with a connecting door into the Study, Trophy Room beyond; the
// long Gallery runs the width of the floor; Den by the lift lobby; the private wing at the back is
// the Boudoir opening into the Master Suite, with the Walk-in Closet tucked in the suite's corner.
// ---------------------------------------------------------------------------------------------
const UPPER_TILES = [
  'xllllll.............qqqx', // 0
  'xllllll../pppppp//..qqqx', // 1   the round Planetarium's cut corners (two-tile slants on the east)
  'xllllll..ppppppppp..qqq.', // 2
  '.........ppppppppp..qqq.', // 3
  'bbbbbbb../pppppp//..qqq.', // 4
  'bbbbbbbssssss...........', // 5
  'bbbbbbbssssss.tttttttt..', // 6
  'bbbbbbbssssss.tttttttt..', // 7
  'bbbbbbbssssss.tttttttt..', // 8
  '........................', // 9
  '.dddddd.gggggggggggggg..', // 10
  '.dddddd.gggggggggggggg..', // 11
  '.dddddd.gggggggggggggg..', // 12
  '........................', // 13
  '.......mmmmmmmmmm.......', // 14
  '.oooooommmmmmmmmm..###..', // 15
  '.oooooommmmmmmmmm..###..', // 16
  '.oooooommmmmmmmmm..###..', // 17
  '.oooooommmmmmmmcc.......', // 18
  '.......mmmmmmmmcc.......', // 19
];
const UPPER_DOORS = [
  '........................', // 0
  '........................', // 1
  '......>..........>....>.', // 2  solarium east, planetarium east, clock tower -> spiral landing
  '.........<..............', // 3  planetarium west
  '......>......v......v...', // 4  library east, planetarium south, clock tower south
  '........................', // 5
  '......>...........^.....', // 6  library -> study (connecting), trophy north
  '........................', // 7
  '...v........>....v......', // 8  library south, study east, trophy south
  '........................', // 9
  '........^...............', // 10 gallery north
  '......>..............>..', // 11 den east, gallery east
  '...v..........v.........', // 12 den south, gallery south
  '........................', // 13
  '..........^.............', // 14 master north
  '.....^..........>.......', // 15 boudoir north, master east
  '......>.................', // 16 boudoir -> master (connecting)
  '........................', // 17
  '...v...........^........', // 18 boudoir south, closet -> master (its only door)
  '.......<................', // 19 master west
];

// ---------------------------------------------------------------------------------------------
// BASEMENT (24 x 20). Left edge faces the Ground Floor: the cellar hatch from the kitchen yard lands
// at rows 1-2 beside the Wine Cellar, the servants' stair from the Kitchen passage at rows 5-6, the
// scullery stair at rows 17-18. Cross-plan Chapel in the middle with the Armory and Boiler Room
// either side, Laboratory top-right, Workshop by the lift, big Gymnasium with a connecting door into
// the Sauna along the bottom, and the Bunker sealed inside a concrete shell at the far end, reached
// only through a 1-wide blast corridor.
// ---------------------------------------------------------------------------------------------
const BASEMENT_TILES = [
  '..wwwwwwwww..aaaaaaaaa..', // 0
  '..wwwwwwwww..aaaaaaaaa..', // 1
  '..wwwwwwwww..aaaaaaaaa..', // 2
  '..wwwwwwwww..aaaaaaaaa..', // 3
  '........................', // 4
  '..rrrrr.x.hhh.x.eeeeeee.', // 5   porch columns either side of the chapel steps
  '..rrrrr...hhh...eeeeeee.', // 6
  '..rrrrr.hhhhhhh.eeeeeee.', // 7
  '........hhhhhhh.........', // 8
  '..........hhh...........', // 9
  '..x..###..hhh..ffffffff.', // 10
  '.....###..hhh..ffffffff.', // 11
  '..x..###..hhh..ffffffff.', // 12
  '...................ffff.', // 13   the workshop steps down a row on its right
  '..yyyyyyyyyyy..x........', // 14
  '..yyyyyyyyyyy....xxxxxxx', // 15
  '..yyyyyyyyyyy..xxxnnnnnx', // 16
  '..yyyyyyyyyyy.....nnnnnx', // 17   blast corridor (15-17,17) into the bunker
  '..uuuuuuu......xxxnnnnnx', // 18
  '..uuuuuuu......xxxxxxxxx', // 19
];
const BASEMENT_DOORS = [
  '........................', // 0
  '..<.......>..........>..', // 1  wine cellar west (by the hatch) + east, laboratory east
  '.............<..........', // 2  laboratory west
  '.....v...........v......', // 3  wine cellar south, laboratory south
  '........................', // 4
  '......>....^....<.....>.', // 5  armory east, chapel north, boiler west + east
  '........................', // 6
  '...v....<.....>.....v...', // 7  armory south, chapel west + east, boiler south
  '........................', // 8
  '........................', // 9
  '...............<.^......', // 10 workshop west + north
  '........................', // 11
  '..................v.....', // 12 workshop south (just before the step)
  '........................', // 13
  '......^.................', // 14 gymnasium north
  '............>...........', // 15 gymnasium east
  '........................', // 16
  '........v.........<.....', // 17 gymnasium -> sauna (connecting), bunker (its only door, at the end of the blast corridor)
  '........................', // 18
  '..<.....................', // 19 sauna west (its only door; the Gymnasium connects in from above)
];

export const SECTION_MAPS: SectionMap[] = [
  { id: 'grounds', title: 'The Grounds', tiles: GROUNDS_TILES, doors: GROUNDS_DOORS },
  { id: 'ground-floor', title: 'Ground Floor', tiles: GROUND_TILES, doors: GROUND_DOORS },
  { id: 'upper-floor', title: 'Upper Floor', tiles: UPPER_TILES, doors: UPPER_DOORS },
  { id: 'basement', title: 'Basement', tiles: BASEMENT_TILES, doors: BASEMENT_DOORS },
];
