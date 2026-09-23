import { expect, it } from "vitest";
import { workbookFor } from "../../src/ProductionInputTab.jsx";

it("downloads the supplied Monday-to-Saturday machine planning layout",()=>{
  const rows=[
    {production_on:"2026-09-21",work_center:"CUTTING",stage:"Cutting",job_card_no:"JC-1",
      order_no:"JO1",article:"BOLT",size_ranges:"4X9",party:"A2Z",planned_pairs:100,actual_pairs:90,unit_key:"u1"},
    {production_on:"2026-09-21",work_center:"CUTTING",stage:"Cutting",job_card_no:"JC-2",
      order_no:"JO2",article:"GOLA",size_ranges:"7X12",party:"MTS",planned_pairs:50,actual_pairs:null,unit_key:"u2"},
    {production_on:"2026-09-22",work_center:"STITCHING",stage:"Stitching",job_card_no:"JC-3",
      order_no:"JO3",article:"JEM",size_ranges:"1X6",party:"RANGOLI",planned_pairs:72,actual_pairs:70,unit_key:"u3"},
  ];
  const wb=workbookFor(rows,"2026-09-21");
  const weekly=wb.Sheets["Weekly Planning Output"];
  const input=wb.Sheets["Daily Input"];

  expect(weekly.A1.v).toContain("2026-09-21 to 2026-09-26");
  expect(weekly.B3.v).toBe("JOB DETAILS");
  expect(weekly.C3.v).toBe("PROPOSED / ACTUAL QTY");
  expect(weekly.B4.v).toContain("JC NO: JC-1");
  expect(weekly.B4.v).toContain("ARTICLE NAME: BOLT");
  expect(weekly.C4.v).toContain("PROPOSED: 100");
  expect(weekly.C4.v).toContain("ACTUAL: 90");
  expect(Object.values(weekly).some(cell=>cell?.v==="SAT\n2026-09-26")).toBe(true);
  expect(Object.values(weekly).some(cell=>String(cell?.v||"").includes("PROPOSED: 150"))).toBe(true);
  expect(input.A1.v).toBe("Production Date");
  expect(input.K1.v).toBe("Achieved Pairs");
  expect(input["!autofilter"].ref).toBe("A1:M4");
});
