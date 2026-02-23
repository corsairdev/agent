import { and, desc, eq } from 'drizzle-orm';
import { db, permissions } from './db';

/**
 * Checks whether a granted (but not yet completed) permission exists for the
 * given endpoint. Returns the permission ID if found, null otherwise.
 */
export async function checkPermission(
	endpoint: string,
): Promise<string | null> {
	const [perm] = await db
		.select({ id: permissions.id })
		.from(permissions)
		.where(
			and(
				eq(permissions.endpoint, endpoint),
				eq(permissions.status, 'granted'),
			),
		)
		.orderBy(desc(permissions.createdAt))
		.limit(1);

	return perm?.id ?? null;
}

/**
 * Marks the most recent granted permission for an endpoint as completed so it
 * cannot be reused (single-use model).
 */
export async function completePermission(endpoint: string): Promise<void> {
	const [perm] = await db
		.select({ id: permissions.id })
		.from(permissions)
		.where(
			and(
				eq(permissions.endpoint, endpoint),
				eq(permissions.status, 'granted'),
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

