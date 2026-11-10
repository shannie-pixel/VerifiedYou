create extension if not exists pgcrypto with schema extensions;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('student', 'lecturer', 'employer')),
  full_name text not null default '',
  institution text not null default '',
  program text not null default '',
  study_year text not null default '',
  about text not null default '',
  career_interests text[] not null default '{}',
  profile_visibility text not null default 'private'
    check (profile_visibility in ('public', 'private')),
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profile_share_tokens (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table public.institution_verifiers (
  user_id uuid primary key references auth.users (id) on delete cascade,
  institution text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.achievements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  category text not null,
  title text not null check (length(trim(title)) between 1 and 200),
  description text not null default '',
  achievement_date date,
  institution text not null default '',
  verifier_name text not null default '',
  proof_path text,
  visibility text not null default 'private'
    check (visibility in ('public', 'link', 'private')),
  status text not null default 'pending'
    check (status in ('pending', 'verified', 'rejected')),
  verifier_user_id uuid references auth.users (id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.achievement_reviews (
  id uuid primary key default gen_random_uuid(),
  achievement_id uuid not null references public.achievements (id) on delete cascade,
  reviewer_user_id uuid not null references auth.users (id) on delete restrict,
  status text not null check (status in ('verified', 'rejected')),
  note text not null default '',
  reviewed_at timestamptz not null default now()
);

create index achievement_reviews_history_idx
  on public.achievement_reviews (achievement_id, reviewed_at desc);

create index achievements_owner_created_idx
  on public.achievements (user_id, created_at desc);
create index achievements_institution_status_idx
  on public.achievements (institution, status, created_at desc);

create table public.employer_shortlists (
  employer_id uuid not null references public.profiles (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (employer_id, student_id),
  check (employer_id <> student_id)
);

create table public.employer_notes (
  employer_id uuid not null references public.profiles (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  note text not null default '',
  updated_at timestamptz not null default now(),
  primary key (employer_id, student_id),
  check (employer_id <> student_id)
);

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger achievements_set_updated_at
before update on public.achievements
for each row execute function public.set_updated_at();

create function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_role text := coalesce(new.raw_user_meta_data ->> 'role', 'student');
begin
  if requested_role not in ('student', 'lecturer', 'employer') then
    requested_role := 'student';
  end if;

  insert into public.profiles (id, role, full_name, institution)
  values (
    new.id,
    requested_role,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.raw_user_meta_data ->> 'institution', '')
  );
  insert into public.profile_share_tokens (user_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.create_profile_for_new_user();

create function public.protect_profile_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role is distinct from old.role
    or new.id is distinct from old.id then
    raise exception 'Account identity fields cannot be changed here';
  end if;
  return new;
end;
$$;

create trigger profiles_protect_identity
before update on public.profiles
for each row execute function public.protect_profile_identity();

create function public.protect_achievement_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  is_verifier boolean;
begin
  if tg_op = 'INSERT' then
    if new.user_id <> auth.uid()
      or new.status <> 'pending'
      or new.verifier_user_id is not null
      or new.verified_at is not null then
      raise exception 'New achievements must be submitted as pending by their owner';
    end if;
    return new;
  end if;

  is_verifier := exists (
    select 1
    from public.institution_verifiers v
    where v.user_id = auth.uid()
      and v.active
      and v.institution = old.institution
  );

  if old.status = 'pending'
    and old.user_id <> auth.uid()
    and is_verifier
    and new.id = old.id
    and new.user_id = old.user_id
    and new.created_at = old.created_at
    and new.institution = old.institution
    and new.title = old.title
    and new.category = old.category
    and new.description = old.description
    and new.achievement_date is not distinct from old.achievement_date
    and new.proof_path is not distinct from old.proof_path
    and new.visibility = old.visibility
    and new.status in ('verified', 'rejected')
    and new.verifier_user_id = auth.uid()
    and new.verified_at is not null
    and exists (
      select 1 from public.achievement_reviews r
      where r.achievement_id = old.id
        and r.reviewer_user_id = auth.uid()
        and r.status = new.status
        and r.reviewed_at >= old.updated_at
    ) then
    return new;
  end if;

  if old.user_id = auth.uid()
    and old.status in ('pending', 'rejected')
    and new.id = old.id
    and new.user_id = old.user_id
    and new.created_at = old.created_at
    and new.institution = old.institution
    and new.status = 'pending'
    and new.verifier_user_id is null
    and new.verified_at is null then
    return new;
  end if;

  raise exception 'You are not allowed to change this achievement';
end;
$$;

create trigger achievements_protect_review
before insert or update on public.achievements
for each row execute function public.protect_achievement_review();

alter table public.profiles enable row level security;
alter table public.profile_share_tokens enable row level security;
alter table public.institution_verifiers enable row level security;
alter table public.achievements enable row level security;
alter table public.achievement_reviews enable row level security;
alter table public.employer_shortlists enable row level security;
alter table public.employer_notes enable row level security;

create policy "Profiles are visible to their owner"
on public.profiles for select to authenticated
using (id = (select auth.uid()));

create policy "Public student profiles are discoverable"
on public.profiles for select to anon, authenticated
using (role = 'student' and profile_visibility = 'public');

create policy "Assigned institutions can read student profiles"
on public.profiles for select to authenticated
using (
  role = 'student'
  and exists (
    select 1 from public.institution_verifiers v
    where v.user_id = (select auth.uid())
      and v.active
      and v.institution = profiles.institution
  )
);

create policy "Users update their own profile"
on public.profiles for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy "Users read their own share token"
on public.profile_share_tokens for select to authenticated
using (user_id = (select auth.uid()));

create policy "Verifiers can read their own authorization"
on public.institution_verifiers for select to authenticated
using (user_id = (select auth.uid()));

create policy "Owners and assigned institutions can read achievements"
on public.achievements for select to authenticated
using (
  user_id = (select auth.uid())
  or (
    exists (
      select 1 from public.institution_verifiers v
      where v.user_id = (select auth.uid())
        and v.active
        and v.institution = achievements.institution
    )
  )
  or (
    status = 'verified'
    and visibility = 'public'
    and exists (
      select 1 from public.profiles p
      where p.id = achievements.user_id
        and p.role = 'student'
        and p.profile_visibility = 'public'
    )
  )
);

create policy "Public verified achievements are readable"
on public.achievements for select to anon
using (
  status = 'verified'
  and visibility = 'public'
  and exists (
    select 1 from public.profiles p
    where p.id = achievements.user_id
      and p.role = 'student'
      and p.profile_visibility = 'public'
  )
);

create policy "Users submit their own achievements"
on public.achievements for insert to authenticated
with check (user_id = (select auth.uid()));

create policy "Owners or assigned institutions update achievements"
on public.achievements for update to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1 from public.institution_verifiers v
    where v.user_id = (select auth.uid())
      and v.active
      and v.institution = achievements.institution
  )
)
with check (
  user_id = (select auth.uid())
  or exists (
    select 1 from public.institution_verifiers v
    where v.user_id = (select auth.uid())
      and v.active
      and v.institution = achievements.institution
  )
);

create policy "Owners delete their unverified achievements"
on public.achievements for delete to authenticated
using (user_id = (select auth.uid()) and status in ('pending', 'rejected'));

create policy "Owners and assigned institutions read review notes"
on public.achievement_reviews for select to authenticated
using (
  exists (
    select 1 from public.achievements a
    where a.id = achievement_id
      and (
        a.user_id = (select auth.uid())
        or exists (
          select 1 from public.institution_verifiers v
          where v.user_id = (select auth.uid())
            and v.active
            and v.institution = a.institution
        )
      )
  )
);

create policy "Assigned institutions add review notes"
on public.achievement_reviews for insert to authenticated
with check (
  reviewer_user_id = (select auth.uid())
  and exists (
    select 1 from public.achievements a
    join public.institution_verifiers v on v.institution = a.institution
    where a.id = achievement_id
      and a.status = 'pending'
      and a.user_id <> (select auth.uid())
      and achievement_reviews.status in ('verified', 'rejected')
      and (
        achievement_reviews.status <> 'rejected'
        or length(trim(achievement_reviews.note)) > 0
      )
      and v.user_id = (select auth.uid())
      and v.active
  )
);

create policy "Employers manage their own shortlists"
on public.employer_shortlists for all to authenticated
using (
  employer_id = (select auth.uid())
  and exists (
    select 1 from public.profiles p
    where p.id = employer_id and p.role = 'employer'
  )
)
with check (
  employer_id = (select auth.uid())
  and exists (
    select 1 from public.profiles p
    where p.id = employer_id and p.role = 'employer'
  )
  and exists (
    select 1 from public.profiles p
    where p.id = student_id and p.role = 'student'
  )
);

create policy "Employers manage their own private notes"
on public.employer_notes for all to authenticated
using (
  employer_id = (select auth.uid())
  and exists (
    select 1 from public.profiles p
    where p.id = employer_id and p.role = 'employer'
  )
)
with check (
  employer_id = (select auth.uid())
  and exists (
    select 1 from public.profiles p
    where p.id = employer_id and p.role = 'employer'
  )
  and exists (
    select 1 from public.profiles p
    where p.id = student_id and p.role = 'student'
  )
);

create function public.get_shared_profile(share_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id,
    'full_name', p.full_name,
    'institution', p.institution,
    'program', p.program,
    'study_year', p.study_year,
    'about', p.about,
    'career_interests', p.career_interests,
    'avatar_path', p.avatar_path,
    'achievements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'category', a.category,
        'title', a.title,
        'description', a.description,
        'achievement_date', a.achievement_date,
        'institution', a.institution,
        'verifier_name', a.verifier_name,
        'visibility', a.visibility,
        'status', a.status,
        'verified_at', a.verified_at
      ) order by a.verified_at desc)
      from public.achievements a
      where a.user_id = p.id
        and a.status = 'verified'
        and a.visibility in ('public', 'link')
    ), '[]'::jsonb)
  )
  from public.profiles p
  join public.profile_share_tokens t on t.user_id = p.id
  where t.token = share_token
    and p.role = 'student';
$$;

grant execute on function public.get_shared_profile(uuid) to anon, authenticated;

create function public.review_achievement(
  achievement_id uuid,
  decision text,
  reviewer_note text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  reviewer uuid := auth.uid();
begin
  if reviewer is null or decision not in ('verified', 'rejected') then
    raise exception 'Invalid review request';
  end if;
  if decision = 'rejected' and coalesce(length(trim(reviewer_note)), 0) = 0 then
    raise exception 'A rejection note is required';
  end if;

  insert into public.achievement_reviews (
    achievement_id, reviewer_user_id, status, note
  )
  values (
    review_achievement.achievement_id, reviewer, decision, coalesce(reviewer_note, '')
  );

  update public.achievements a
  set status = decision,
      verifier_user_id = reviewer,
      verified_at = now(),
      verifier_name = coalesce(
        (select p.full_name from public.profiles p where p.id = reviewer),
        ''
      )
  where a.id = review_achievement.achievement_id
    and a.status = 'pending';

  if not found then
    raise exception 'The request is no longer pending or is not accessible';
  end if;
end;
$$;

revoke all on function public.review_achievement(uuid, text, text) from public, anon;
grant execute on function public.review_achievement(uuid, text, text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('proof-documents', 'proof-documents', false, 15728640,
    array['application/pdf', 'image/png', 'image/jpeg']),
  ('profile-avatars', 'profile-avatars', false, 5242880,
    array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "Owners manage proof documents"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'proof-documents'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Owners and assigned verifiers read proof documents"
on storage.objects for select to authenticated
using (
  bucket_id = 'proof-documents'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (
      select 1
      from public.achievements a
      join public.institution_verifiers v on v.institution = a.institution
      where a.proof_path = name
        and a.user_id <> (select auth.uid())
        and v.user_id = (select auth.uid())
        and v.active
    )
  )
);

create policy "Owners delete proof documents"
on storage.objects for delete to authenticated
using (
  bucket_id = 'proof-documents'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Owners upload avatars"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Owners and public profile viewers read avatars"
on storage.objects for select to anon, authenticated
using (
  bucket_id = 'profile-avatars'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (
      select 1 from public.profiles p
      where p.id::text = (storage.foldername(name))[1]
        and p.avatar_path = name
        and p.profile_visibility = 'public'
    )
  )
);

create policy "Owners delete avatars"
on storage.objects for delete to authenticated
using (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
