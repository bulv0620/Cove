import { Layers, icons as lucideIcons, type LucideIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { PermissionItem } from '@/features/identity/types';

export function ResourceIcon({
  icon,
  className,
}: {
  icon: string | null | undefined;
  className?: string;
}): JSX.Element {
  const Icon = ((icon && (lucideIcons as Record<string, LucideIcon>)[icon]) ||
    Layers) as LucideIcon;
  return <Icon className={className} />;
}

export function PermissionPicker({
  permissions,
  selected,
  onChange,
  disabled = false,
}: {
  permissions: PermissionItem[];
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}): JSX.Element {
  const { t } = useTranslation();
  const permissionTree = useMemo(() => {
    const selectedSet = new Set(selected);
    const actionsByParent = permissions
      .filter((permission) => permission.type === 'ACTION' && permission.parentId)
      .reduce<Record<string, PermissionItem[]>>((groups, permission) => {
        (groups[permission.parentId ?? ''] ??= []).push(permission);
        return groups;
      }, {});
    const resources = permissions
      .filter((permission) => permission.type === 'PAGE')
      .sort(
        (first, second) =>
          first.resource.sortOrder - second.resource.sortOrder ||
          first.resource.code.localeCompare(second.resource.code),
      )
      .reduce<
        Record<
          string,
          {
            resource: PermissionItem['resource'];
            pages: Array<{
              page: PermissionItem;
              actions: PermissionItem[];
            }>;
          }
        >
      >((groups, page) => {
        (groups[page.resourceId] ??= { resource: page.resource, pages: [] }).pages.push({
          page,
          actions: (actionsByParent[page.id] ?? []).sort(
            (first, second) => first.sortOrder - second.sortOrder,
          ),
        });
        return groups;
      }, {});

    return Object.values(resources).map(({ resource, pages }) => ({
      resource,
      pages: pages.map(({ page, actions }) => ({
        page,
        actions,
        isSelected: selectedSet.has(page.id),
        selectedActionCount: actions.filter((action) => selectedSet.has(action.id)).length,
      })),
    }));
  }, [permissions, selected]);
  const moduleGroups = useMemo(() => {
    const moduleOrder = ['identity', 'infrastructure', 'system'];
    return Object.entries(
      permissionTree.reduce<Record<string, typeof permissionTree>>((groups, item) => {
        (groups[item.resource.module] ??= []).push(item);
        return groups;
      }, {}),
    ).sort(
      ([first], [second]) =>
        (moduleOrder.indexOf(first) === -1 ? moduleOrder.length : moduleOrder.indexOf(first)) -
          (moduleOrder.indexOf(second) === -1 ? moduleOrder.length : moduleOrder.indexOf(second)) ||
        first.localeCompare(second),
    );
  }, [permissionTree]);

  const togglePage = (page: PermissionItem, actions: PermissionItem[]) => {
    if (selected.includes(page.id)) {
      const actionIds = new Set(actions.map(({ id }) => id));
      onChange(selected.filter((id) => id !== page.id && !actionIds.has(id)));
      return;
    }
    onChange([...new Set([...selected, page.id])]);
  };

  const toggleAction = (page: PermissionItem, action: PermissionItem) => {
    if (selected.includes(action.id)) {
      onChange(selected.filter((id) => id !== action.id));
      return;
    }
    onChange([...new Set([...selected, page.id, action.id])]);
  };

  const moduleLabels: Record<string, string> = {
    identity: t('resources.modules.identity'),
    infrastructure: t('resources.modules.infrastructure'),
    system: t('resources.modules.system'),
  };

  return (
    <div className="space-y-5">
      {moduleGroups.map(([module, items]) => (
        <section key={module} aria-labelledby={`permission-module-${module}`}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 id={`permission-module-${module}`} className="text-sm font-semibold">
              {moduleLabels[module] ?? module}
            </h3>
            <p className="text-xs text-muted-foreground">
              {t('roles.resourcesCount', { count: items.length })}
            </p>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {items.flatMap(({ resource, pages }) =>
              pages.map(({ page, actions, isSelected, selectedActionCount }) => (
                <section key={page.id} className="overflow-hidden rounded-lg border bg-card">
                  <label
                    className={cn(
                      'flex min-h-14 items-start gap-3 px-3 py-3 text-sm',
                      !disabled && 'cursor-pointer hover:bg-muted/50',
                    )}
                  >
                    <input
                      type="checkbox"
                      disabled={disabled}
                      checked={isSelected}
                      onChange={() => togglePage(page, actions)}
                      className="mt-0.5 h-4 w-4 accent-primary"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <ResourceIcon icon={resource.icon} className="h-4 w-4 text-primary" />
                        <span className="font-medium">{resource.name || page.name}</span>
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                          {t('roles.pageAccess')}
                        </span>
                      </span>
                      <span className="mt-1 block truncate font-mono text-[11px] text-muted-foreground">
                        {resource.code}
                      </span>
                      {actions.length > 0 && (
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {t('roles.selectedActions', {
                            selected: selectedActionCount,
                            total: actions.length,
                          })}
                        </span>
                      )}
                    </span>
                  </label>
                  {actions.length > 0 && (
                    <div className="border-t bg-muted/20 p-3">
                      <p className="mb-2 text-xs font-medium text-muted-foreground">
                        {t('roles.actions')}
                      </p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {actions.map((action) => (
                          <label
                            key={action.id}
                            className={cn(
                              'flex min-h-11 items-start gap-3 rounded-md px-2 py-2 text-sm',
                              !disabled && 'cursor-pointer hover:bg-background',
                            )}
                          >
                            <input
                              type="checkbox"
                              disabled={disabled}
                              checked={selected.includes(action.id)}
                              onChange={() => toggleAction(page, action)}
                              className="mt-0.5 h-4 w-4 accent-primary"
                            />
                            <span className="min-w-0 flex-1 overflow-hidden">
                              <span className="block truncate font-medium" title={action.name}>
                                {action.name}
                              </span>
                              <span
                                className="block truncate font-mono text-[11px] text-muted-foreground"
                                title={action.code}
                              >
                                {action.code}
                              </span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </section>
              )),
            )}
          </div>
        </section>
      ))}
      {moduleGroups.length === 0 && (
        <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          {t('roles.noPagePermissions')}
        </div>
      )}
    </div>
  );
}
