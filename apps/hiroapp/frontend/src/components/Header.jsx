import React, { useEffect, useRef, useState } from "react";
import UserProfile from "./UserProfile";
import Navigation from "./Navigation";

const Header = () => {
    const [showProfile, setShowProfile] = useState(false);
    const profileRef = useRef(null);

    const toggleProfile = () => {
        setShowProfile((prev) => !prev);
    };

    const handleClickOutside = (ev) => {
        const isModalClosed = ev.target.classList.contains("close-btn"); //close button from message close in ShowMessage
        if (
            profileRef.current &&
            !profileRef.current.contains(ev.target) &&
            !isModalClosed
        ) {
            setShowProfile(false);
        }
    };

    useEffect(() => {
        document.addEventListener("click", handleClickOutside);
        return () => {
            document.removeEventListener("click", handleClickOutside);
        };
    }, []);

    return (
        <header className="Header">
            <span className="page_title">HiroApp</span>
            <Navigation />
            <div ref={profileRef}>
                <a className="profile" onClick={toggleProfile}>
                    Profile
                </a>
                {showProfile && <UserProfile />}
            </div>
        </header>
    );
};

export default Header;
