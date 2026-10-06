import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { isPlatformAdmin } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { NewOrganizationForm } from "./new-organization-form";

export default async function NewOrganizationPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user || !(await isPlatformAdmin(supabase, data.user.id))) redirect("/organizations");

  return (
    <>
      <PageHeader title="Nueva empresa" subtitle="Se crea con proveedor de pruebas (mock). Producción se configura aparte." />
      <NewOrganizationForm />
    </>
  );
}
