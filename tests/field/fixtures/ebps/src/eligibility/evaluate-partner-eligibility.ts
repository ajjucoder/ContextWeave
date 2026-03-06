import { loadPartnerRules } from "../rules/load-partner-rules";

export function evaluatePartnerEligibility(student: {
  hasDistrictApproval: boolean;
}) {
  const rules = loadPartnerRules();

  if (rules.requireDistrictApproval) {
    return student.hasDistrictApproval;
  }

  return true;
}
