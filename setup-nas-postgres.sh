#!/usr/bin/expect -f

set timeout 30
set password "JEsus777\$\$!"

# Connect to NAS and check Docker
spawn ssh Ben@192.168.1.84

expect {
    "password:" {
        send "$password\r"
        expect "Ben@"

        # Check if PostgreSQL container exists
        send "docker ps -a | grep postgres\r"
        expect "Ben@"

        # Create PostgreSQL container for LeadRipper
        send "docker run -d --name leadripper-db -e POSTGRES_PASSWORD=LeadRipper2026\$\$! -e POSTGRES_USER=leadripper -e POSTGRES_DB=leadripper_db -p 5432:5432 -v /volume1/docker/leadripper-db:/var/lib/postgresql/data postgres:15\r"
        expect "Ben@"

        # Show container status
        send "docker ps | grep leadripper-db\r"
        expect "Ben@"

        send "exit\r"
    }
    timeout {
        puts "Connection timed out"
        exit 1
    }
    eof {
        puts "Connection closed"
        exit 1
    }
}

expect eof
