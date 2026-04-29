import { Hono } from 'hono';
import type { Database } from '../db/index.ts';
import { createNotebooksDAL } from '../dal/notebooks.dal.ts';
import { createStacksDAL } from '../dal/stacks.dal.ts';

/**
 * Creates notebook and notebook-stack API routes.
 *
 * Endpoints:
 *   GET    /notebooks              — list all notebooks with stacks and note counts
 *   POST   /notebooks              — create notebook
 *   PUT    /notebooks/:id          — update notebook (rename, move to stack)
 *   DELETE /notebooks/:id          — delete notebook
 *   POST   /notebook-stacks        — create stack
 *   PUT    /notebook-stacks/:id    — rename stack
 *   DELETE /notebook-stacks/:id    — delete stack
 */
export function createNotebooksRoutes(db: Database): Hono {
  const app = new Hono();
  const notebooksDAL = createNotebooksDAL(db);
  const stacksDAL = createStacksDAL(db);

  // ── Notebook routes ──────────────────────────────────────────────

  /**
   * GET /notebooks — list all notebooks with stacks and note counts.
   */
  app.get('/notebooks', (c) => {
    const notebooks = notebooksDAL.getAll();
    return c.json(notebooks);
  });

  /**
   * POST /notebooks — create a new notebook.
   * Body: { name: string, stackId?: string }
   */
  app.post('/notebooks', async (c) => {
    const body = await c.req.json<{ name?: string; stackId?: string | null }>();

    if (!body.name || body.name.trim().length === 0) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Notebook name is required',
            field: 'name',
          },
        },
        400,
      );
    }

    try {
      const notebook = notebooksDAL.create(body.name, body.stackId ?? null);
      return c.json(notebook, 201);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('already exists')) {
        return c.json(
          {
            error: {
              code: 'DUPLICATE_NAME',
              message,
              field: 'name',
            },
          },
          409,
        );
      }
      throw err;
    }
  });

  /**
   * PUT /notebooks/:id — update a notebook (rename, move to stack).
   * Body: { name?: string, stackId?: string | null }
   */
  app.put('/notebooks/:id', async (c) => {
    const { id } = c.req.param();
    const body = await c.req.json<{ name?: string; stackId?: string | null }>();

    // If name is provided, it must not be empty
    if (body.name !== undefined && body.name.trim().length === 0) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Notebook name cannot be empty',
            field: 'name',
          },
        },
        400,
      );
    }

    try {
      const previousNotebook = notebooksDAL.getById(id);
      const updated = notebooksDAL.update(id, {
        name: body.name,
        stackId: body.stackId,
      });

      if (!updated) {
        return c.json(
          {
            error: {
              code: 'NOT_FOUND',
              message: `Notebook '${id}' not found`,
            },
          },
          404,
        );
      }

      // Auto-clean empty stacks when a notebook moves between stacks
      if (
        previousNotebook &&
        previousNotebook.stack_id !== null &&
        previousNotebook.stack_id !== updated.stack_id
      ) {
        stacksDAL.autoCleanEmpty();
      }

      return c.json(updated);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('already exists')) {
        return c.json(
          {
            error: {
              code: 'DUPLICATE_NAME',
              message,
              field: 'name',
            },
          },
          409,
        );
      }
      throw err;
    }
  });

  /**
   * DELETE /notebooks/:id — delete a notebook.
   * Notes in the notebook are cascade-deleted by the schema.
   */
  app.delete('/notebooks/:id', (c) => {
    const { id } = c.req.param();
    const deleted = notebooksDAL.delete(id);

    if (!deleted) {
      return c.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: `Notebook '${id}' not found`,
          },
        },
        404,
      );
    }

    // Auto-clean empty stacks after notebook deletion
    stacksDAL.autoCleanEmpty();

    return c.json({ success: true });
  });

  // ── Notebook Stack routes ────────────────────────────────────────

  /**
   * POST /notebook-stacks — create a new stack.
   * Body: { name: string }
   */
  app.post('/notebook-stacks', async (c) => {
    const body = await c.req.json<{ name?: string }>();

    if (!body.name || body.name.trim().length === 0) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Stack name is required',
            field: 'name',
          },
        },
        400,
      );
    }

    try {
      const stack = stacksDAL.create(body.name);
      return c.json(stack, 201);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('already exists')) {
        return c.json(
          {
            error: {
              code: 'DUPLICATE_NAME',
              message,
              field: 'name',
            },
          },
          409,
        );
      }
      throw err;
    }
  });

  /**
   * PUT /notebook-stacks/:id — rename a stack.
   * Body: { name: string }
   */
  app.put('/notebook-stacks/:id', async (c) => {
    const { id } = c.req.param();
    const body = await c.req.json<{ name?: string }>();

    if (!body.name || body.name.trim().length === 0) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Stack name is required',
            field: 'name',
          },
        },
        400,
      );
    }

    try {
      const updated = stacksDAL.update(id, body.name);

      if (!updated) {
        return c.json(
          {
            error: {
              code: 'NOT_FOUND',
              message: `Stack '${id}' not found`,
            },
          },
          404,
        );
      }

      return c.json(updated);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('already exists')) {
        return c.json(
          {
            error: {
              code: 'DUPLICATE_NAME',
              message,
              field: 'name',
            },
          },
          409,
        );
      }
      throw err;
    }
  });

  /**
   * DELETE /notebook-stacks/:id — delete a stack.
   * Notebooks in the stack have their stack_id set to NULL.
   */
  app.delete('/notebook-stacks/:id', (c) => {
    const { id } = c.req.param();
    const deleted = stacksDAL.delete(id);

    if (!deleted) {
      return c.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: `Stack '${id}' not found`,
          },
        },
        404,
      );
    }

    return c.json({ success: true });
  });

  return app;
}
