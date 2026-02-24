import { and, desc, eq, sql } from 'drizzle-orm';
import { db, permissions } from './db';

/**
 * Checks whether a granted (but not yet completed) permission exists for the
 * given endpoint and exact args. Each distinct set of args requires its own
 * approval — e.g. creating two different issues needs two separate grants.
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
 * Marks the granted permission for this specific endpoint + args as completed
 * so it cannot be reused.
 */
export async function completePermission(
	endpoint: string,
	args: unknown,
): Promise<void> {
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

	if (perm) {
		await db
			.update(permissions)
			.set({ status: 'completed', updatedAt: new Date() })
			.where(eq(permissions.id, perm.id));
	}
}
