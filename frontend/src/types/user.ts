export interface CurrentUser {
  id: string;
  name: string | null;
  email: string;
  role: string;
  active: boolean;
}
