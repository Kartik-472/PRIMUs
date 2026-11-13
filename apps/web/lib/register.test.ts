import { describe, expect, test } from "vitest";
import { formToRegistration } from "./register";

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

describe("formToRegistration", () => {
  test("a Thapar team keeps roll numbers and drops empty member rows", () => {
    expect(
      formToRegistration(form({
        category: "THAPAR", team_name: " Alpha ", college: "ignored", leader_email: "a@x.in", leader_phone: "98765 43210",
        member_name_0: "Asha", member_roll_0: "102", member_name_1: "Bilal", member_roll_1: "103", member_name_2: " ",
      })),
    ).toEqual({
      category: "THAPAR", team_name: "Alpha", college: "", leader_email: "a@x.in", leader_phone: "98765 43210",
      members: [{ full_name: "Asha", roll_number: "102" }, { full_name: "Bilal", roll_number: "103" }],
    });
  });

  test("an outside team gives its college and no roll numbers", () => {
    const r = formToRegistration(form({ category: "OUTSIDE", team_name: "B", college: "PEC", member_name_0: "C", member_roll_0: "9", member_name_1: "D" }));
    expect(r.college).toBe("PEC");
    expect(r.members).toEqual([{ full_name: "C", roll_number: "" }, { full_name: "D", roll_number: "" }]);
  });
});
