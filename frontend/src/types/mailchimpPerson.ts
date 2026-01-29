export type MailchimpPerson = {
  person_id: string;
  name: string;
  email: string | null;
  label_ids: string[];
  org_id: string | null;
  org_address: string | null;
  size_employees: string | null;
  segment: string | null;
  employee_count: number | null;
  annual_revenue: number | null;
  formacion: string | null;
  servicio: string | null;
  created_at: string | null;
  updated_at: string | null;
};
