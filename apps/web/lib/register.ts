// The public registration form: the pure part (form fields to the database function's input), unit-tested.

export const MAX_MEMBERS = 5;

/** Pure: turns the submitted form into the database function's input. */
export function formToRegistration(form: FormData) {
  const text = (key: string) => String(form.get(key) ?? "").trim();
  const category = text("category") === "OUTSIDE" ? "OUTSIDE" : "THAPAR";
  const members = Array.from({ length: MAX_MEMBERS }, (_, i) => ({
    full_name: text(`member_name_${i}`),
    roll_number: category === "THAPAR" ? text(`member_roll_${i}`) : "",
  })).filter((m) => m.full_name !== "");
  return {
    category,
    team_name: text("team_name"),
    college: category === "OUTSIDE" ? text("college") : "",
    leader_email: text("leader_email"),
    leader_phone: text("leader_phone"),
    members,
  };
}
