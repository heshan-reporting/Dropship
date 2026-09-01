import { redirect } from 'next/navigation';
import { adminConfigured, isAuthenticated, startSession, verifyPassword } from '@/lib/auth';
import { STORE } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await isAuthenticated()) redirect('/admin');
  const { error } = await searchParams;

  async function signIn(formData: FormData) {
    'use server';

    if (!adminConfigured()) redirect('/login?error=unconfigured');

    const password = String(formData.get('password') ?? '');
    if (!verifyPassword(password)) {
      // Deliberately vague: nothing here should help someone guess.
      redirect('/login?error=invalid');
    }

    await startSession();
    redirect('/admin');
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-5">
      <h1 className="font-display text-2xl tracking-tight">
        {STORE.name} admin
      </h1>
      <p className="mt-2 text-sm text-ink-soft">Sign in to manage the store.</p>

      <form action={signIn} className="mt-8 space-y-4">
        <div>
          <label htmlFor="password" className="block text-sm text-ink-soft">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            autoFocus
            className="mt-1.5 w-full rounded border border-black/15 bg-white px-3 py-2 text-sm outline-none focus:border-brand"
          />
        </div>

        {error === 'invalid' && (
          <p className="text-sm text-bad">That password was not correct.</p>
        )}
        {error === 'unconfigured' && (
          <p className="text-sm text-bad">
            ADMIN_PASSWORD is not set on the server.
          </p>
        )}

        <button
          type="submit"
          className="w-full rounded-full bg-ink px-5 py-2.5 text-sm text-white transition hover:bg-black"
        >
          Sign in
        </button>
      </form>
    </div>
  );
}
