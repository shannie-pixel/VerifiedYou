import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function response(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeHtml(value: string) {
  const entities: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return value.replace(/[&<>"']/g, (char) => entities[char] ?? char);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return response(405, { error: "Method not allowed" });

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return response(401, { error: "Authentication required" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail = Deno.env.get("RESEND_FROM_EMAIL");
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !resendApiKey || !fromEmail) {
    console.error("Recommendation email notification is missing server configuration.");
    return response(503, { error: "Email notifications are not configured." });
  }

  let requestId: string;
  try {
    const body = await request.json();
    requestId = body.requestId;
    if (typeof requestId !== "string" || !/^[0-9a-f-]{36}$/i.test(requestId)) {
      return response(400, { error: "A valid recommendation request ID is required." });
    }
  } catch {
    return response(400, { error: "Invalid request body." });
  }

  const token = authorization.slice("Bearer ".length);
  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData.user) return response(401, { error: "Authentication failed." });

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: recommendation, error: requestError } = await admin
    .from("recommendation_requests")
    .select("id,student_id,institution,recipient_type,recipient_user_id,recipient_name,purpose,message,deadline,status,email_notified_at")
    .eq("id", requestId)
    .eq("student_id", authData.user.id)
    .single();
  if (requestError || !recommendation) return response(404, { error: "Recommendation request not found." });
  if (recommendation.status !== "pending") return response(409, { error: "The request is no longer pending." });
  if (recommendation.email_notified_at) return response(200, { sent: true, alreadySent: true });

  let recipientIds: string[];
  if (recommendation.recipient_type === "lecturer" && recommendation.recipient_user_id) {
    recipientIds = [recommendation.recipient_user_id];
  } else {
    const { data: verifiers, error: verifierError } = await admin
      .from("institution_verifiers")
      .select("user_id")
      .eq("institution", recommendation.institution)
      .eq("active", true);
    if (verifierError) {
      console.error("Could not load recommendation request recipients.", verifierError);
      return response(500, { error: "Could not load the institution's reviewers." });
    }
    const verifierIds = (verifiers ?? []).map((verifier) => verifier.user_id);
    let lecturers: { id: string }[] = [];
    if (verifierIds.length) {
      const { data, error } = await admin.from("profiles").select("id")
        .eq("role", "lecturer").eq("institution", recommendation.institution)
        .in("id", verifierIds);
      if (error) {
        console.error("Could not load institution lecturer recipients.", error);
        return response(500, { error: "Could not load the institution's lecturers." });
      }
      lecturers = data ?? [];
    }
    recipientIds = lecturers.map((lecturer) => lecturer.id);
  }

  const recipients: string[] = [];
  for (const userId of [...new Set(recipientIds)]) {
    const { data: userData, error: userError } = await admin.auth.admin.getUserById(userId);
    if (userError) {
      console.error("Could not load a recommendation request recipient.", userError);
      return response(500, { error: "Could not load a request recipient." });
    }
    if (userData.user?.email) recipients.push(userData.user.email);
  }
  if (recipients.length === 0) return response(409, { error: "No recipient email address is available." });

  const { data: student, error: studentError } = await admin
    .from("profiles")
    .select("full_name,program,institution")
    .eq("id", recommendation.student_id)
    .single();
  if (studentError) {
    console.error("Could not load the recommendation request student.", studentError);
    return response(500, { error: "Could not load student details." });
  }

  const studentName = escapeHtml(student.full_name || "A student");
  const purpose = escapeHtml(recommendation.purpose);
  const institution = escapeHtml(recommendation.institution);
  const message = escapeHtml(recommendation.message || "No additional message was provided.");
  const deadline = recommendation.deadline
    ? `<p><strong>Needed by:</strong> ${escapeHtml(recommendation.deadline)}</p>`
    : "";
  const program = student.program ? `<p><strong>Programme:</strong> ${escapeHtml(student.program)}</p>` : "";
  const result = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: recipients,
      subject: `Recommendation letter request from ${student.full_name || "a student"}`,
      html: `<p>${studentName} has requested a recommendation letter from ${escapeHtml(recommendation.recipient_name)}.</p>
        <p><strong>Purpose:</strong> ${purpose}</p>
        <p><strong>Institution:</strong> ${institution}</p>
        ${program}${deadline}
        <p><strong>Message:</strong></p><p>${message}</p>
        <p>Sign in to VerifiedYou to review the request and attach a completed letter.</p>`,
      text: `${student.full_name || "A student"} has requested a recommendation letter from ${recommendation.recipient_name}.\nPurpose: ${recommendation.purpose}\nInstitution: ${recommendation.institution}\n${student.program ? `Programme: ${student.program}\n` : ""}${recommendation.deadline ? `Needed by: ${recommendation.deadline}\n` : ""}Message: ${recommendation.message || "No additional message was provided."}\n\nSign in to VerifiedYou to review the request.`,
    }),
  });
  if (!result.ok) {
    console.error("Recommendation email provider returned an error.", await result.text());
    return response(502, { error: "Email notification could not be delivered." });
  }

  const { error: updateError } = await admin
    .from("recommendation_requests")
    .update({ email_notified_at: new Date().toISOString() })
    .eq("id", recommendation.id)
    .is("email_notified_at", null);
  if (updateError) {
    console.error("Email was sent, but the notification timestamp could not be saved.", updateError);
    return response(500, { error: "Email was sent, but notification status could not be saved." });
  }

  return response(200, { sent: true });
});
