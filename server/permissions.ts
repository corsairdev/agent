import { and, desc, eq, sql } from 'drizzle-orm';
import { db, permissions } from './db';

/**
 * Checks whether a granted (but not yet completed) permission exists for the
 * given endpoint and exact args. Strict matching ensures the API call uses
 * exactly what the user approved.
 */
export async function checkPermission(
	endpoint: string,
	args: unknown,
): Promise<string | null> {
	const [perm] = await db
		.select({ id: permissions.id })
		.from(permissions)
		.where(
			and(
				eq(permissions.endpoint, endpoint),
				eq(permissions.status, 'granted'),
				sql`${permissions.args} = ${JSON.stringify(args)}::jsonb`,
			),
		)
		.orderBy(desc(permissions.createdAt))
		.limit(1);

	return perm?.id ?? null;
}

/**
 * Marks a granted permission as completed so it cannot be reused (single-use model).
 */
export async function completePermission(id: string): Promise<void> {
	await db
		.update(permissions)
		.set({ status: 'completed', updatedAt: new Date() })
		.where(eq(permissions.id, id));
}
