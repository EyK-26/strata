import axios from "axios";
import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

const Position = () => {
	const [position, setPosition] = useState(null);
	const { id } = useParams();
	const navigate = useNavigate();

	const loadPosition = async () => {
		try {
			const response = await axios.get(`/api/positions/${id}`);
			setPosition(response.data);
			if (response.data.hiring !== 1) {
				navigate("/");
			}
		} catch (error) {
			console.log(error.response.data);
		}
	};

	useEffect(() => {
		loadPosition();
	}, []);

	return (
		<div className="Position">
			{position ? (
				<>
					<div className="detail-header">
						<h2>{position.name}</h2>
						<Link to={"/apply/" + id}>
							<button>Apply</button>
						</Link>
					</div>
					<div className="detail-info">
						<span>Department: {position.department.name}</span>
						<span>Grade : {position.grade.name}</span>
						<span>{position.description}</span>
					</div>
				</>
			) : (
				<span>Position does not exist</span>
			)}
		</div>
	);
};

export default Position;
