-- Nur lokale Entwicklung: Prisma Migrate braucht eine "Shadow-Datenbank" und damit das Recht, Datenbanken anzulegen.
GRANT ALL PRIVILEGES ON *.* TO 'kahal'@'%';
FLUSH PRIVILEGES;
