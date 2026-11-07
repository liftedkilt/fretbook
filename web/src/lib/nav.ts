/** Which top-level destinations the shell shows. Lessons is experimental and off unless the user opts in. */
export function sideNavIds(lessons: boolean): string[] {
  return ["practice", "library", ...(lessons ? ["lessons"] : []), "setlists", "tools"];
}

/** Phone tab bar, left to right around the (+) button. Setlists takes Lessons' slot when Lessons is off. */
export function tabBarIds(lessons: boolean): string[] {
  return ["practice", "library", lessons ? "lessons" : "setlists", "tools"];
}
