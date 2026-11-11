create table public.recommendation_requests (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  institution text not null check (length(trim(institution)) between 1 and 200),
  recipient_type text not null check (recipient_type in ('lecturer', 'institution')),
  recipient_user_id uuid references auth.users (id) on delete set null,
  recipient_name text not null default '' check (length(recipient_name) <= 200),
  purpose text not null check (length(trim(purpose)) between 1 and 160),
  message text not null default '' check (length(message) <= 2000),
  deadline date,
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'rejected')),
  response_note text not null default '' check (length(response_note) <= 2000),
  letter_path text,
  email_notified_at timestamptz,
  reviewer_user_id uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (recipient_type = 'lecturer' or recipient_user_id is null),
  check (
    (status = 'pending' and reviewer_user_id is null and reviewed_at is null
      and letter_path is null and response_note = '')
    or (status = 'completed' and reviewer_user_id is not null and reviewed_at is not null
      and letter_path is not null)
    or (status = 'rejected' and reviewer_user_id is not null and reviewed_at is not null
      and letter_path is null and length(trim(response_note)) > 0)
  )
);

create index recommendation_requests_student_created_idx
  on public.recommendation_requests (student_id, created_at desc);
create index recommendation_requests_institution_status_idx
  on public.recommendation_requests (institution, status, created_at desc);
create index recommendation_requests_recipient_status_idx
  on public.recommendation_requests (recipient_user_id, status, created_at desc);

create trigger recommendation_requests_set_updated_at
before update on public.recommendation_requests
for each row execute function public.set_updated_at();

create function public.set_recommendation_recipient_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.recipient_type = 'institution' then
    if not exists (
      select 1
      from public.institution_verifiers v
      join public.profiles p on p.id = v.user_id and p.role = 'lecturer'
      where v.institution = new.institution
        and v.active
    ) then
      raise exception 'No active institution reviewers are available';
    end if;
    new.recipient_name := new.institution;
  else
    if new.recipient_user_id is null then
      raise exception 'Choose a lecturer registered with your institution';
    end if;
    select coalesce(nullif(trim(p.full_name), ''), 'Lecturer')
      into new.recipient_name
    from public.profiles p
    where p.id = new.recipient_user_id
      and p.role = 'lecturer'
      and p.institution = new.institution;
    if not found then
      raise exception 'Choose a lecturer registered with your institution';
    end if;
  end if;
  return new;
end;
$$;

create trigger recommendation_requests_set_recipient_name
before insert on public.recommendation_requests
for each row execute function public.set_recommendation_recipient_name();

alter table public.recommendation_requests enable row level security;
revoke all on public.recommendation_requests from anon, authenticated;
grant select, insert on public.recommendation_requests to authenticated;

create policy "Students and addressed lecturers read recommendation requests"
on public.recommendation_requests for select to authenticated
using (
  student_id = (select auth.uid())
  or exists (
    select 1
    from public.institution_verifiers v
    join public.profiles p on p.id = v.user_id and p.role = 'lecturer'
    where v.user_id = (select auth.uid())
      and v.active
      and (
        recommendation_requests.recipient_type = 'institution'
        and v.institution = recommendation_requests.institution
      )
  )
  or (
    recipient_type = 'lecturer'
    and recipient_user_id = (select auth.uid())
  )
);

create policy "Students submit recommendation requests to their institution"
on public.recommendation_requests for insert to authenticated
with check (
  student_id = (select auth.uid())
  and status = 'pending'
  and email_notified_at is null
  and reviewer_user_id is null
  and reviewed_at is null
  and letter_path is null
  and response_note = ''
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'student'
      and p.institution = recommendation_requests.institution
  )
  and (
    (recipient_type = 'institution' and recipient_user_id is null)
    or (recipient_type = 'lecturer' and recipient_user_id is not null)
  )
);

create function public.get_recommendation_lecturers()
returns table (user_id uuid, full_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  student_institution text;
begin
  select p.institution into student_institution
  from public.profiles p
  where p.id = auth.uid()
    and p.role = 'student';

  if not found or length(trim(student_institution)) = 0 then
    raise exception 'A student profile with an institution is required';
  end if;

  return query
  select p.id, coalesce(nullif(trim(p.full_name), ''), 'Lecturer')
  from public.profiles p
  where p.role = 'lecturer'
    and p.institution = student_institution
  order by p.full_name, p.id;
end;
$$;

revoke all on function public.set_recommendation_recipient_name() from public, anon, authenticated;

revoke all on function public.get_recommendation_lecturers() from public, anon;
grant execute on function public.get_recommendation_lecturers() to authenticated;

create function public.get_recommendation_request_student(request_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  request_row public.recommendation_requests%rowtype;
  student_profile public.profiles%rowtype;
begin
  select r.* into request_row
  from public.recommendation_requests r
  where r.id = get_recommendation_request_student.request_id
    and (
      r.student_id = auth.uid()
      or (
        r.recipient_type = 'lecturer'
        and r.recipient_user_id = auth.uid()
      )
      or (
        r.recipient_type = 'institution'
        and exists (
          select 1 from public.institution_verifiers v
          join public.profiles lecturer_profile
            on lecturer_profile.id = v.user_id
            and lecturer_profile.role = 'lecturer'
          where v.user_id = auth.uid()
            and v.institution = r.institution
            and v.active
        )
      )
    );
  if not found then
    raise exception 'Recommendation request not found or not accessible';
  end if;

  select p.* into student_profile
  from public.profiles p
  where p.id = request_row.student_id;
  if not found then
    raise exception 'Student profile not found';
  end if;

  return jsonb_build_object(
    'full_name', student_profile.full_name,
    'program', student_profile.program,
    'institution', student_profile.institution
  );
end;
$$;

revoke all on function public.get_recommendation_request_student(uuid) from public, anon;
grant execute on function public.get_recommendation_request_student(uuid) to authenticated;

create function public.review_recommendation_request(
  request_id uuid,
  decision text,
  reviewer_note text,
  completed_letter_path text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  reviewer uuid := auth.uid();
  request_row public.recommendation_requests%rowtype;
begin
  if reviewer is null
    or decision is null
    or decision not in ('completed', 'rejected')
    or length(coalesce(reviewer_note, '')) > 2000 then
    raise exception 'Invalid recommendation request review';
  end if;

  select r.* into request_row
  from public.recommendation_requests r
  where r.id = review_recommendation_request.request_id
    and r.status = 'pending'
  for update;

  if not found then
    raise exception 'The request is no longer pending or is not accessible';
  end if;

  if request_row.recipient_type = 'lecturer' then
    if request_row.recipient_user_id <> reviewer or not exists (
      select 1 from public.profiles p
      where p.id = reviewer
        and p.role = 'lecturer'
        and p.institution = request_row.institution
    ) then
      raise exception 'You are not the lecturer selected for this request';
    end if;
  elsif not exists (
    select 1
    from public.institution_verifiers v
    join public.profiles p on p.id = v.user_id and p.role = 'lecturer'
    where v.user_id = reviewer
      and v.active
      and v.institution = request_row.institution
  ) then
    raise exception 'You are not assigned to this recommendation request';
  end if;

  if decision = 'rejected' then
    if length(trim(coalesce(reviewer_note, ''))) = 0
      or completed_letter_path is not null then
      raise exception 'A rejection note is required and no letter may be attached';
    end if;
  else
    if completed_letter_path is null
      or (storage.foldername(completed_letter_path))[1] <> request_row.id::text
      or not exists (
        select 1
        from storage.objects o
        where o.bucket_id = 'recommendation-letters'
          and o.name = completed_letter_path
          and o.metadata ->> 'mimetype' = 'application/pdf'
      ) then
      raise exception 'Upload a PDF letter for this request before completing it';
    end if;
  end if;

  update public.recommendation_requests r
  set status = decision,
      response_note = coalesce(reviewer_note, ''),
      letter_path = completed_letter_path,
      reviewer_user_id = reviewer,
      reviewed_at = now()
  where r.id = request_row.id;
end;
$$;

revoke all on function public.review_recommendation_request(uuid, text, text, text)
  from public, anon;
grant execute on function public.review_recommendation_request(uuid, text, text, text)
  to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'recommendation-letters',
  'recommendation-letters',
  false,
  10485760,
  array['application/pdf']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "Assigned lecturers upload recommendation letters"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'recommendation-letters'
  and metadata ->> 'mimetype' = 'application/pdf'
  and exists (
    select 1
    from public.recommendation_requests r
    where r.id::text = (storage.foldername(name))[1]
      and r.status = 'pending'
      and (
        (
          r.recipient_type = 'institution'
          and exists (
            select 1 from public.institution_verifiers v
            where v.user_id = (select auth.uid())
              and v.institution = r.institution
              and v.active
          )
        )
        or (
          r.recipient_type = 'lecturer'
          and r.recipient_user_id = (select auth.uid())
          and exists (
            select 1 from public.profiles p
            where p.id = (select auth.uid())
              and p.role = 'lecturer'
              and p.institution = r.institution
          )
        )
      )
  )
);

create policy "Request participants read completed recommendation letters"
on storage.objects for select to authenticated
using (
  bucket_id = 'recommendation-letters'
  and exists (
    select 1 from public.recommendation_requests r
    where r.letter_path = name
      and (
        r.student_id = (select auth.uid())
        or r.reviewer_user_id = (select auth.uid())
      )
  )
);

create policy "Assigned lecturers remove pending recommendation letters"
on storage.objects for delete to authenticated
using (
  bucket_id = 'recommendation-letters'
  and exists (
    select 1
    from public.recommendation_requests r
    where r.id::text = (storage.foldername(name))[1]
    and r.status = 'pending'
    and (
      (
        r.recipient_type = 'institution'
        and exists (
          select 1 from public.institution_verifiers v
          where v.user_id = (select auth.uid())
            and v.institution = r.institution
            and v.active
        )
      )
      or (
        r.recipient_type = 'lecturer'
        and r.recipient_user_id = (select auth.uid())
        and exists (
          select 1 from public.profiles p
          where p.id = (select auth.uid())
            and p.role = 'lecturer'
            and p.institution = r.institution
        )
      )
    )
  )
);
